// src/controllers/response.controller.js
import { pool } from '../config/database.js'
import { v4 as uuidv4 } from 'uuid'
import { odooService } from '../services/odoo.service.js'

export class ResponseController {

  // ═══════════════════════════════════════
  // VALIDAR ESTUDIANTE EN ODOO
  // ═══════════════════════════════════════
  static async validateStudent(req, reply) {
    const { email, form_uuid } = req.body

    if (!email) {
      return reply.code(400).send({ ok: false, error: 'Email es requerido' })
    }

    try {
      const connection = await pool.getConnection()
      try {
        const [forms] = await connection.query(
          `SELECT id, requires_odoo_validation, odoo_course_name 
           FROM forms WHERE uuid = ? AND is_active = 1`,
          [form_uuid]
        )

        if (!forms.length) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const form = forms[0]

        if (!form.requires_odoo_validation) {
          return reply.send({ 
            ok: true, 
            validated: false,
            message: 'Este formulario no requiere validación Odoo'
          })
        }

        const result = await odooService.validateStudent(email)

        if (!result.ok) {
          return reply.code(400).send({
            ok: false,
            error: result.error,
            code: result.code
          })
        }

        return reply.send({
          ok: true,
          validated: true,
          student: result.student
        })

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al validar estudiante' })
    }
  }

  // ═══════════════════════════════════════
  // ENVIAR RESPUESTA (SUBMIT)
  // ═══════════════════════════════════════
  static async submit(req, reply) {
    const { 
      form_uuid, 
      answers = [], 
      respondent_email, 
      respondent_name, 
      time_spent,
      odoo_partner_id,
      odoo_student_names,
      odoo_student_surnames
    } = req.body
    
    if (!form_uuid) {
      return reply.code(400).send({ ok: false, error: 'form_uuid es requerido' })
    }

    const connection = await pool.getConnection()
    
    try {
      await connection.beginTransaction()

      // 1. Obtener formulario
      const [forms] = await connection.query(
        `SELECT id, form_type, passing_score, show_score_after_submit, 
                show_correct_answers, title,
                requires_odoo_validation, odoo_course_name, 
                odoo_slide_channel_id, odoo_academic_hours, odoo_course_type
         FROM forms WHERE uuid = ? AND is_active = 1`,
        [form_uuid]
      )
      
      if (!forms.length) {
        await connection.rollback()
        return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
      }
      
      const form = forms[0]
      const isExam = form.form_type === 'EXAM'

      // 2. Crear respuesta
      const responseUuid = uuidv4()
      const [responseResult] = await connection.query(`
        INSERT INTO form_responses (
          response_uuid, form_id, respondent_email, respondent_name,
          odoo_partner_id, odoo_student_names, odoo_student_surnames,
          status, started_at, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', NOW(), NOW())
      `, [
        responseUuid, form.id, respondent_email, respondent_name,
        odoo_partner_id || null, odoo_student_names || null, odoo_student_surnames || null
      ])
      
      const responseId = responseResult.insertId

      // 3. Obtener preguntas
      const [questions] = await connection.query(`
        SELECT q.id, q.question_text, q.points, q.question_type_id,
               qt.code as type_code
        FROM questions q
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE q.form_id = ? AND q.is_active = 1
      `, [form.id])

      const questionMap = new Map()
      for (const q of questions) {
        questionMap.set(q.id, q)
      }

      // 4. Obtener opciones correctas
      const questionIds = questions.map(q => q.id)
      let correctOptionsMap = new Map()
      
      if (questionIds.length > 0) {
        const [options] = await connection.query(`
          SELECT question_id, id, option_text, is_correct, points
          FROM question_options
          WHERE question_id IN (?) AND is_active = 1
        `, [questionIds])
        
        for (const opt of options) {
          if (!correctOptionsMap.has(opt.question_id)) {
            correctOptionsMap.set(opt.question_id, [])
          }
          correctOptionsMap.get(opt.question_id).push(opt)
        }
      }

      // 5. Procesar respuestas
      let totalScore = 0
      let maxPossibleScore = 0
      let correctCount = 0
      const details = []

      for (const answer of answers) {
        const question = questionMap.get(answer.question_id)
        if (!question) continue

        const qOptions = correctOptionsMap.get(answer.question_id) || []
        const correctOptions = qOptions.filter(o => o.is_correct)
        
        const questionMaxScore = parseFloat(question.points) || 
          correctOptions.reduce((sum, o) => sum + (parseFloat(o.points) || 1), 0) || 1
        maxPossibleScore += parseFloat(questionMaxScore)

        let isCorrect = false
        let earnedPoints = 0
        let userAnswerText = ''
        let correctAnswerText = correctOptions.map(o => o.option_text).join(', ')

        const typeCode = (question.type_code || '').toUpperCase()

        // RADIO, SELECT, DROPDOWN, SINGLE_CHOICE - Selección única
        if (typeCode === 'RADIO' || typeCode === 'SELECT' || typeCode === 'DROPDOWN' || typeCode === 'SINGLE_CHOICE') {
          const selectedId = Array.isArray(answer.answer_value) ? answer.answer_value[0] : answer.answer_value
          const selectedOption = qOptions.find(o => o.id === selectedId)
          userAnswerText = selectedOption?.option_text || String(answer.answer_value || '')
          isCorrect = selectedOption?.is_correct || false
          earnedPoints = isCorrect ? parseFloat(questionMaxScore) : 0
        } 
        // CHECKBOX, MULTIPLE_CHOICE - Selección múltiple
        else if (typeCode === 'CHECKBOX' || typeCode === 'MULTIPLE_CHOICE') {
          const selectedIds = Array.isArray(answer.answer_value) 
            ? answer.answer_value 
            : [answer.answer_value].filter(Boolean)
          const correctIds = correctOptions.map(o => o.id)
          
          const selectedTexts = qOptions
            .filter(o => selectedIds.includes(o.id))
            .map(o => o.option_text)
          userAnswerText = selectedTexts.join(', ') || String(answer.answer_value || '')
          
          isCorrect = selectedIds.length === correctIds.length &&
                      selectedIds.every(id => correctIds.includes(id))
          earnedPoints = isCorrect ? parseFloat(questionMaxScore) : 0
        }
        // TRUE_FALSE
        else if (typeCode === 'TRUE_FALSE') {
          userAnswerText = answer.answer_value === true ? 'Verdadero' : 'Falso'
          const correctOpt = correctOptions[0]
          if (correctOpt) {
            const correctValue = correctOpt.option_text.toLowerCase() === 'verdadero'
            isCorrect = answer.answer_value === correctValue
          }
          earnedPoints = isCorrect ? parseFloat(questionMaxScore) : 0
        }
        // TEXT, TEXTAREA, EMAIL, NUMBER, etc.
        else {
          userAnswerText = String(answer.answer_value || '')
          correctAnswerText = '(Requiere revisión manual)'
          isCorrect = null
        }

        if (isCorrect === true) {
          correctCount++
          totalScore += earnedPoints
        }

        await connection.query(`
          INSERT INTO response_answers (
            response_id, question_id, answer_text,
            is_correct, points_earned
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          responseId, 
          answer.question_id,
          userAnswerText,
          isCorrect === true ? 1 : (isCorrect === false ? 0 : null),
          earnedPoints
        ])

        details.push({
          question_id: answer.question_id,
          question_text: question.question_text,
          user_answer: userAnswerText,
          correct_answer: correctAnswerText,
          is_correct: isCorrect,
          points_earned: earnedPoints,
          points_possible: questionMaxScore
        })
      }

      // 6. Calcular porcentaje
      const percentage = maxPossibleScore > 0 
        ? Math.round((totalScore / maxPossibleScore) * 100) 
        : 0
      const passed = form.passing_score 
        ? percentage >= parseFloat(form.passing_score) 
        : null

      // 7. Actualizar respuesta
      await connection.query(`
        UPDATE form_responses SET
          total_score = ?,
          max_possible_score = ?,
          percentage_score = ?,
          passed = ?
        WHERE id = ?
      `, [totalScore, maxPossibleScore, percentage, passed ? 1 : 0, responseId])

      // 8. CERTIFICACIÓN EN ODOO
      let odooResult = null
      
      if (isExam && passed && form.requires_odoo_validation && odoo_partner_id && form.odoo_course_name) {
        try {
          const certResult = await odooService.certifyStudent(
            {
              partner_id: odoo_partner_id,
              names: odoo_student_names || respondent_name,
              surnames: odoo_student_surnames || ''
            },
            {
              course_name: form.odoo_course_name,
              final_score: totalScore,
              completion_date: new Date().toISOString()
            }
          )

          if (certResult.ok) {
            await connection.query(`
              UPDATE form_responses SET
                odoo_certificate_id = ?,
                odoo_certificate_pdf = ?
              WHERE id = ?
            `, [certResult.certificate.id, certResult.certificate.pdf_url, responseId])

            odooResult = {
              certificate_id: certResult.certificate.id,
              pdf_url: certResult.certificate.pdf_url,
              message: '¡Certificado generado! Ya puedes verlo en la intranet de W|E'
            }
          } else {
            console.error('Error certificando en Odoo:', certResult.error)
            odooResult = {
              error: true,
              message: 'Tu respuesta fue guardada pero hubo un error generando el certificado.'
            }
          }
        } catch (odooError) {
          console.error('Odoo certification error:', odooError)
          odooResult = { error: true, message: 'Error al generar certificado en Odoo' }
        }
      }

      await connection.commit()

      // 9. Respuesta
      const response = {
        ok: true,
        data: {
          response_uuid: responseUuid,
          submitted: true,
          exam_title: form.title
        }
      }

      if (isExam && form.show_score_after_submit) {
        response.data.score = percentage
        response.data.passed = passed
        response.data.correct_count = correctCount
        response.data.total_questions = questions.length
        response.data.total_score = totalScore
        response.data.max_score = maxPossibleScore
        response.data.passing_score = form.passing_score
        response.data.time_spent = time_spent

        if (form.show_correct_answers) {
          response.data.details = details
        }

        if (odooResult) {
          response.data.odoo = odooResult
        }
      }

      return reply.send(response)

    } catch (error) {
      await connection.rollback()
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al enviar respuesta' })
    } finally {
      connection.release()
    }
  }

  // ═══════════════════════════════════════
  // OBTENER RESPUESTA POR ID
  // ═══════════════════════════════════════
  static async getById(req, reply) {
    const { id } = req.params

    try {
      const connection = await pool.getConnection()
      try {
        const [responses] = await connection.query(`
          SELECT r.*, f.title as form_title, f.form_type
          FROM form_responses r
          JOIN forms f ON r.form_id = f.id
          WHERE r.id = ?
        `, [id])

        if (!responses.length) {
          return reply.code(404).send({ ok: false, error: 'Respuesta no encontrada' })
        }

        const response = responses[0]

        // Obtener respuestas individuales
        const [answers] = await connection.query(`
          SELECT ra.*, q.question_text
          FROM response_answers ra
          JOIN questions q ON ra.question_id = q.id
          WHERE ra.response_id = ?
          ORDER BY q.display_order
        `, [id])

        return reply.send({
          ok: true,
          data: {
            ...response,
            answers
          }
        })

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener respuesta' })
    }
  }

  // ═══════════════════════════════════════
  // LISTAR RESPUESTAS
  // ═══════════════════════════════════════
  static async list(req, reply) {
    const { form_id, page = 1, limit = 20, status } = req.query

    try {
      const connection = await pool.getConnection()
      try {
        let whereClause = '1=1'
        const params = []

        if (form_id) {
          whereClause += ' AND r.form_id = ?'
          params.push(form_id)
        }

        if (status) {
          whereClause += ' AND r.status = ?'
          params.push(status)
        }

        // Count
        const [countResult] = await connection.query(`
          SELECT COUNT(*) as total
          FROM form_responses r
          WHERE ${whereClause}
        `, params)

        // Data
        const offset = (page - 1) * limit
        const [responses] = await connection.query(`
          SELECT r.*, f.title as form_title, f.form_type
          FROM form_responses r
          JOIN forms f ON r.form_id = f.id
          WHERE ${whereClause}
          ORDER BY r.submitted_at DESC
          LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset])

        return reply.send({
          ok: true,
          data: {
            responses,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: countResult[0].total,
              pages: Math.ceil(countResult[0].total / limit)
            }
          }
        })

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al listar respuestas' })
    }
  }

  // ═══════════════════════════════════════
  // ELIMINAR RESPUESTA
  // ═══════════════════════════════════════
  static async delete(req, reply) {
    const { id } = req.params

    try {
      const connection = await pool.getConnection()
      try {
        const [result] = await connection.query(
          'DELETE FROM form_responses WHERE id = ?',
          [id]
        )

        if (result.affectedRows === 0) {
          return reply.code(404).send({ ok: false, error: 'Respuesta no encontrada' })
        }

        return reply.send({ ok: true, message: 'Respuesta eliminada' })

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al eliminar respuesta' })
    }
  }

  // ═══════════════════════════════════════
  // OBTENER RESULTADO (para pantalla de resultados)
  // ═══════════════════════════════════════
  static async getResult(req, reply) {
    const { response_uuid } = req.params

    try {
      const connection = await pool.getConnection()
      try {
        const [responses] = await connection.query(`
          SELECT 
            r.*, f.title as exam_title, f.passing_score,
            f.show_score_after_submit, f.show_correct_answers
          FROM form_responses r
          JOIN forms f ON r.form_id = f.id
          WHERE r.response_uuid = ?
        `, [response_uuid])

        if (!responses.length) {
          return reply.code(404).send({ ok: false, error: 'Respuesta no encontrada' })
        }

        const response = responses[0]

        let details = []
        if (response.show_correct_answers) {
          const [answers] = await connection.query(`
            SELECT 
              ra.question_id, ra.answer_text, ra.is_correct, 
              ra.points_earned, q.question_text, q.points as points_possible
            FROM response_answers ra
            JOIN questions q ON ra.question_id = q.id
            WHERE ra.response_id = ?
            ORDER BY q.display_order
          `, [response.id])

          for (const ans of answers) {
            const [correctOpts] = await connection.query(`
              SELECT option_text FROM question_options
              WHERE question_id = ? AND is_correct = 1
            `, [ans.question_id])

            details.push({
              question_id: ans.question_id,
              question_text: ans.question_text,
              user_answer: ans.answer_text,
              correct_answer: correctOpts.map(o => o.option_text).join(', '),
              is_correct: !!ans.is_correct,
              points_earned: ans.points_earned,
              points_possible: ans.points_possible
            })
          }
        }

        return reply.send({
          ok: true,
          data: {
            response_uuid: response.response_uuid,
            exam_title: response.exam_title,
            score: response.percentage_score,
            passed: !!response.passed,
            correct_count: details.filter(d => d.is_correct).length,
            total_questions: details.length,
            total_score: response.total_score,
            max_score: response.max_possible_score,
            passing_score: response.passing_score,
            submitted_at: response.submitted_at,
            details: response.show_correct_answers ? details : [],
            odoo: response.odoo_certificate_id ? {
              certificate_id: response.odoo_certificate_id,
              pdf_url: response.odoo_certificate_pdf
            } : null
          }
        })

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener resultado' })
    }
  }
}