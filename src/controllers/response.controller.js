// src/controllers/response.controller.js
import { pool, getConnectionWithRetry } from '../config/database.js'
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
      // 1. Obtener formulario CON slide_channel_id
      const [forms] = await connection.query(
        `SELECT id, requires_odoo_validation, odoo_course_name, odoo_slide_channel_id 
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

      // 2. Validar estudiante + inscripción en curso
      const result = await odooService.validateStudentWithEnrollment(
        email,
        form.odoo_slide_channel_id,
          form.odoo_course_name  // Agregar esto
 // Pasar el ID del curso
      )

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
      answers, 
      time_spent,
      respondent_email,
      respondent_name,
      odoo_partner_id,
      odoo_student_names,
      odoo_student_surnames,
      questions_shown
    } = req.body

    const connection = await pool.getConnection()
    
    try {
      await connection.beginTransaction()

      // 1. Obtener formulario
      const [forms] = await connection.query(
        `SELECT id, form_type, passing_score, show_score_after_submit, 
                show_correct_answers, title,
                requires_odoo_validation, odoo_course_name, 
                odoo_slide_channel_id, odoo_academic_hours, odoo_course_type,
                use_question_bank, questions_to_show
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
          questions_shown,
          status, started_at, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', NOW(), NOW())
      `, [
        responseUuid, form.id, respondent_email, respondent_name,
        odoo_partner_id || null, odoo_student_names || null, odoo_student_surnames || null,
        questions_shown ? JSON.stringify(questions_shown) : null
      ])
      
      const responseId = responseResult.insertId

      // 3. Obtener preguntas
      let questionsQuery = `
        SELECT q.id, q.question_text, q.points, q.question_type_id,
              qt.code as type_code
        FROM questions q
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE q.form_id = ? AND q.is_active = 1
      `
      let queryParams = [form.id]

      if (questions_shown && questions_shown.length > 0) {
        questionsQuery += ` AND q.id IN (?)`
        queryParams.push(questions_shown)
      }

      const [questions] = await connection.query(questionsQuery, queryParams)

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
          WHERE question_id IN (?)
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
      let correctCount = 0
      let maxPossibleScore = 0
      const details = []

      for (const answer of answers) {
        const question = questionMap.get(answer.question_id)
        if (!question) continue

        const questionPoints = parseFloat(question.points) || 1
        maxPossibleScore += questionPoints
        
        let isCorrect = null
        let pointsEarned = 0
        let answerText = ''
        let correctAnswerText = ''

        const typeCode = question.type_code?.toUpperCase()
        const questionOptions = correctOptionsMap.get(question.id) || []
        const correctOptions = questionOptions.filter(o => o.is_correct)

        if (typeCode === 'RADIO' || typeCode === 'SINGLE_CHOICE') {
          const selectedId = parseInt(answer.answer_value)
          const selectedOption = questionOptions.find(o => o.id === selectedId)
          answerText = selectedOption?.option_text || 'Sin respuesta'
          
          if (correctOptions.length > 0) {
            const correctOption = correctOptions[0]
            correctAnswerText = correctOption.option_text
            isCorrect = selectedId === correctOption.id
            if (isCorrect) {
              pointsEarned = questionPoints
              correctCount++
            }
          }
        } else if (typeCode === 'CHECKBOX' || typeCode === 'MULTIPLE_CHOICE') {
          const selectedIds = Array.isArray(answer.answer_value) 
            ? answer.answer_value.map(id => parseInt(id))
            : []
          const selectedOptions = questionOptions.filter(o => selectedIds.includes(o.id))
          answerText = selectedOptions.map(o => o.option_text).join(', ') || 'Sin respuesta'
          
          if (correctOptions.length > 0) {
            correctAnswerText = correctOptions.map(o => o.option_text).join(', ')
            const correctIds = correctOptions.map(o => o.id)
            isCorrect = selectedIds.length === correctIds.length &&
                        selectedIds.every(id => correctIds.includes(id))
            if (isCorrect) {
              pointsEarned = questionPoints
              correctCount++
            }
          }
        } else if (typeCode === 'TRUE_FALSE') {
          const userAnswer = answer.answer_value
          answerText = userAnswer === true ? 'Verdadero' : userAnswer === false ? 'Falso' : 'Sin respuesta'
          
          if (correctOptions.length > 0) {
            const correctOption = correctOptions[0]
            correctAnswerText = correctOption.option_text
            const correctBool = correctOption.option_value === 'true' || 
                              correctOption.option_text?.toLowerCase() === 'verdadero'
            isCorrect = userAnswer === correctBool
            if (isCorrect) {
              pointsEarned = questionPoints
              correctCount++
            }
          }
        } else {
          answerText = String(answer.answer_value || '')
        }

        totalScore += pointsEarned

        await connection.query(`
          INSERT INTO response_answers (
            response_id, question_id, answer_text, is_correct, points_earned
          ) VALUES (?, ?, ?, ?, ?)
        `, [responseId, question.id, answerText, isCorrect, pointsEarned])

        details.push({
          question_id: question.id,
          question_text: question.question_text,
          user_answer: answerText,
          correct_answer: correctAnswerText,
          is_correct: isCorrect,
          points: questionPoints,
          points_earned: pointsEarned
        })
      }

      // 6. Calcular porcentaje y si aprobó
      const percentage = maxPossibleScore > 0 
        ? Math.round((totalScore / maxPossibleScore) * 100) 
        : 0
      const passed = form.passing_score ? percentage >= form.passing_score : true

      // 7. Actualizar form_response con resultados
      await connection.query(`
        UPDATE form_responses SET
          total_score = ?,
          max_possible_score = ?,
          percentage_score = ?,
          passed = ?,
          duration_minutes = ?
        WHERE id = ?
      `, [totalScore, maxPossibleScore, percentage, passed ? 1 : 0, time_spent, responseId])

      // ✅ COMMIT Y LIBERAR CONEXIÓN ANTES DE RESPONDER
      await connection.commit()
      connection.release()
const submittedAt = new Date().toISOString() // ✅ Capturar la fecha del submit

      // 8. Preparar respuesta
const response = {
  ok: true,
  data: {
    response_uuid: responseUuid,
    submitted: true,
    exam_title: form.title,
    certificate_processing: false,
    submitted_at: submittedAt // ✅ AGREGAR ESTO
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
  response.data.submitted_at = submittedAt // ✅ ASEGURAR QUE ESTÉ AQUÍ TAMBIÉN

  if (form.show_correct_answers) {
    response.data.details = details
  }
}

      // ⚡ VERIFICAR SI DEBE CERTIFICAR (para mostrar mensaje)
      const shouldCertify = isExam && 
                           passed && 
                           form.requires_odoo_validation && 
                           odoo_partner_id && 
                           form.odoo_course_name

      if (shouldCertify) {
        response.data.certificate_processing = true
        response.data.odoo = {
          message: '🎓 Tu certificado está siendo generado y estará disponible en unos momentos...'
        }
      }

      // ✅ ENVIAR RESPUESTA INMEDIATAMENTE AL CLIENTE
      reply.send(response)

      // 🔄 PROCESO ASÍNCRONO EN SEGUNDO PLANO (NO ESPERA)
      if (shouldCertify) {
        processCertificationAsync(
          responseId,
          {
            partner_id: odoo_partner_id,
            names: odoo_student_names || respondent_name || '',
            surnames: odoo_student_surnames || ''
          },
          {
            course_name: form.odoo_course_name,
            final_score: totalScore,
            completion_date: new Date().toISOString()
          },
          req.log
        )
      }

    } catch (error) {
      await connection.rollback()
      connection.release()
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al enviar respuesta' })
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

        const [countResult] = await connection.query(`
          SELECT COUNT(*) as total
          FROM form_responses r
          WHERE ${whereClause}
        `, params)

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
  // OBTENER RESULTADO
  // ═══════════════════════════════════════
static async getResult(req, reply) {
    const { response_uuid } = req.params

    let connection = null

    try {
      // Usar retry para evitar ECONNRESET
      connection = await getConnectionWithRetry()

      // 1. Obtener la respuesta principal
      const [responses] = await connection.query(`
        SELECT 
          r.id, r.response_uuid, r.total_score, r.max_possible_score,
          r.percentage_score, r.passed, r.submitted_at, r.status,
          r.odoo_certificate_id, r.odoo_certificate_pdf,
          r.respondent_email, r.odoo_student_names, r.odoo_student_surnames,
          f.title as exam_title, f.passing_score,
          f.show_score_after_submit, f.show_correct_answers
        FROM form_responses r
        JOIN forms f ON r.form_id = f.id
        WHERE r.response_uuid = ?
      `, [response_uuid])

      if (!responses.length) {
        return reply.code(404).send({ ok: false, error: 'Respuesta no encontrada' })
      }

      const response = responses[0]

      // 2. Obtener respuestas + opciones correctas en UN SOLO query (elimina N+1)
      let details = []
      let correctCount = 0
      let totalQuestions = 0

      const [answersWithCorrect] = await connection.query(`
        SELECT 
          ra.question_id,
          ra.answer_text,
          ra.is_correct,
          ra.points_earned,
          q.question_text,
          q.points as points_possible,
          q.display_order,
          GROUP_CONCAT(
            CASE WHEN qo.is_correct = 1 THEN qo.option_text END
            ORDER BY qo.id
            SEPARATOR ', '
          ) as correct_answer_text
        FROM response_answers ra
        JOIN questions q ON ra.question_id = q.id
        LEFT JOIN question_options qo ON qo.question_id = q.id
        WHERE ra.response_id = ?
        GROUP BY ra.id, ra.question_id, ra.answer_text, ra.is_correct, 
                 ra.points_earned, q.question_text, q.points, q.display_order
        ORDER BY q.display_order
      `, [response.id])

      // Liberar conexión INMEDIATAMENTE después de los queries
      connection.release()
      connection = null

      // 3. Procesar resultados (ya sin conexión abierta)
      totalQuestions = answersWithCorrect.length

      for (const ans of answersWithCorrect) {
        if (ans.is_correct) correctCount++

        if (response.show_correct_answers) {
          details.push({
            question_id: ans.question_id,
            question_text: ans.question_text,
            user_answer: ans.answer_text,
            correct_answer: ans.correct_answer_text || '',
            is_correct: !!ans.is_correct,
            points_earned: ans.points_earned,
            points_possible: ans.points_possible
          })
        }
      }

      // 4. Verificar certificado
      const certificateReady = !!response.odoo_certificate_id

      return reply.send({
        ok: true,
        data: {
          response_uuid: response.response_uuid,
          exam_title: response.exam_title,
          score: response.percentage_score,
          passed: !!response.passed,
          correct_count: correctCount,
          total_questions: totalQuestions,
          total_score: response.total_score,
          max_score: response.max_possible_score,
          passing_score: response.passing_score,
          submitted_at: response.submitted_at,
          details: response.show_correct_answers ? details : [],
          odoo: certificateReady ? {
            certificate_id: response.odoo_certificate_id,
            pdf_url: response.odoo_certificate_pdf
          } : null,
          certificate_processing: !certificateReady && !!response.passed
        }
      })

    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener resultado' })
    } finally {
      if (connection) connection.release()
    }
  }

  static async getCertificatePdf(req, reply) {
    const { responseUuid } = req.params

    try {
      const connection = await pool.getConnection()
      try {
        const [responses] = await connection.query(`
          SELECT odoo_certificate_id, odoo_certificate_pdf
          FROM form_responses
          WHERE response_uuid = ?
        `, [responseUuid])

        if (!responses.length || !responses[0].odoo_certificate_id) {
          return reply.code(404).send({ ok: false, error: 'Certificado no encontrado' })
        }

        const { odoo_certificate_id } = responses[0]

        const { odooService } = await import('../services/odoo.service.js')
        const pdfBase64 = await odooService.getCertificatePdfBase64(odoo_certificate_id)

        if (!pdfBase64) {
          return reply.code(404).send({ ok: false, error: 'PDF no disponible' })
        }

        const pdfBuffer = Buffer.from(pdfBase64, 'base64')
        
        reply.header('Content-Type', 'application/pdf')
        reply.header('Content-Disposition', `inline; filename="certificado-${responseUuid}.pdf"`)
        
        return reply.send(pdfBuffer)

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener certificado' })
    }
  }

static async checkPreviousResponse(req, reply) {
  const { form_uuid, respondent_email } = req.query

  console.log('🔍 checkPreviousResponse llamado:', { form_uuid, respondent_email })

  if (!form_uuid || !respondent_email) {
    return reply.code(400).send({ 
      ok: false, 
      error: 'form_uuid y respondent_email son requeridos' 
    })
  }

  try {
    const connection = await pool.getConnection()
    try {
      // 1. Obtener el formulario
      const [forms] = await connection.query(
        `SELECT id, title, passing_score, allow_multiple_responses, 
                show_correct_answers, form_type, use_question_bank, questions_to_show
        FROM forms WHERE uuid = ? AND is_active = 1`,
        [form_uuid]
      )

      if (!forms.length) {
        return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
      }

      const form = forms[0]

      // 2. Buscar respuesta previa del estudiante
      const [responses] = await connection.query(
        `SELECT 
          id,
          response_uuid,
          total_score,
          max_possible_score,
          percentage_score,
          passed,
          submitted_at,
          odoo_certificate_id,
          odoo_certificate_pdf,
          questions_shown
        FROM form_responses
        WHERE form_id = ? 
          AND respondent_email = ?
          AND status = 'SUBMITTED'
        ORDER BY submitted_at DESC
        LIMIT 1`,
        [form.id, respondent_email]
      )

      // 3. Si NO tiene respuesta previa
      if (!responses.length) {
        console.log('✅ No tiene respuesta previa')
        return reply.send({
          ok: true,
          has_previous_response: false,
          can_take_exam: true
        })
      }

      const response = responses[0]
      console.log('📝 Response ID encontrado:', response.id)

      // ═══════════════════════════════════════
      // 4. CALCULAR correct_count y total_questions
      // ═══════════════════════════════════════
      let correctCount = 0
      let totalQuestions = 0

      // Primero intentar desde response_answers
      const [statsResult] = await connection.query(`
        SELECT 
          COUNT(*) as total_questions,
          COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) as correct_count
        FROM response_answers
        WHERE response_id = ?
      `, [response.id])

      const stats = statsResult[0] || { total_questions: 0, correct_count: 0 }
      
      // Si hay datos en response_answers, usarlos
      if (parseInt(stats.total_questions) > 0) {
        correctCount = parseInt(stats.correct_count) || 0
        totalQuestions = parseInt(stats.total_questions) || 0
        console.log('📊 Stats desde response_answers:', { correctCount, totalQuestions })
      } else {
        // ⚠️ FALLBACK: Calcular desde form_responses y questions
        console.log('⚠️ No hay datos en response_answers, calculando fallback...')
        
        // 1. Obtener total de preguntas del formulario
        const [questionCount] = await connection.query(
          `SELECT COUNT(*) as count, SUM(points) as total_points 
           FROM questions WHERE form_id = ? AND is_active = 1`,
          [form.id]
        )
        
        const formQuestionCount = parseInt(questionCount[0]?.count) || 0
        const formTotalPoints = parseFloat(questionCount[0]?.total_points) || 0
        
        // 2. Determinar totalQuestions
        if (form.use_question_bank && form.questions_to_show) {
          totalQuestions = parseInt(form.questions_to_show)
        } else {
          totalQuestions = formQuestionCount
        }
        
        // 3. Calcular correctCount basado en puntuación
        const totalScore = parseFloat(response.total_score) || 0
        const maxScore = parseFloat(response.max_possible_score) || 0
        const percentage = parseFloat(response.percentage_score) || 0
        
        console.log('📊 Datos disponibles:', { totalScore, maxScore, percentage, totalQuestions })
        
        if (totalQuestions > 0) {
          // Si tiene max_score, calcular puntos por pregunta
          if (maxScore > 0) {
            const pointsPerQuestion = maxScore / totalQuestions
            correctCount = Math.round(totalScore / pointsPerQuestion)
          } else if (percentage > 0) {
            // Fallback al porcentaje
            correctCount = Math.round((percentage / 100) * totalQuestions)
          }
        }
        
        console.log('📊 Stats calculados (fallback):', { correctCount, totalQuestions })
      }

      // 5. Contar intentos previos
      const [attemptCount] = await connection.query(
        `SELECT COUNT(*) as attempts FROM form_responses 
         WHERE form_id = ? AND respondent_email = ? AND status = 'SUBMITTED'`,
        [form.id, respondent_email]
      )
      const attemptNumber = attemptCount[0]?.attempts || 1

      // 6. Si APROBÓ
      if (response.passed) {
        console.log('✅ APROBÓ - correct_count:', correctCount, 'total:', totalQuestions)
        return reply.send({
          ok: true,
          has_previous_response: true,
          can_take_exam: false,
          status: 'PASSED',
          attempt_number: attemptNumber,
          data: {
            response_uuid: response.response_uuid,
            score: response.percentage_score,
            total_score: response.total_score,
            max_score: response.max_possible_score,
            passing_score: form.passing_score,
            submitted_at: response.submitted_at,
            certificate_id: response.odoo_certificate_id,
            certificate_pdf: response.odoo_certificate_pdf,
            exam_title: form.title,
            correct_count: correctCount,
            total_questions: totalQuestions
          }
        })
      }

      // 7. Si REPROBÓ
      console.log('❌ REPROBÓ - correct_count:', correctCount, 'total:', totalQuestions)
      return reply.send({
        ok: true,
        has_previous_response: true,
        can_take_exam: attemptNumber < 2,
        status: 'FAILED',
        attempt_number: attemptNumber,
        data: {
          response_uuid: response.response_uuid,
          score: response.percentage_score,
          total_score: response.total_score,
          max_score: response.max_possible_score,
          passing_score: form.passing_score,
          submitted_at: response.submitted_at,
          exam_title: form.title,
          allow_retry: attemptNumber < 2,
          correct_count: correctCount,
          total_questions: totalQuestions
        }
      })

    } finally {
      connection.release()
    }
  } catch (error) {
    req.log.error(error)
    console.error('❌ Error en checkPreviousResponse:', error)
    return reply.code(500).send({ 
      ok: false, 
      error: 'Error al verificar respuesta previa' 
    })
  }
}
}

// ═══════════════════════════════════════
// 🔄 FUNCIÓN ASÍNCRONA PARA CERTIFICACIÓN
// ═══════════════════════════════════════
async function processCertificationAsync(responseId, studentData, examData, logger) {
  let connection = null
  
  try {
    logger.info(`🎯 [Async] Iniciando certificación para response_id: ${responseId}`)
    
    const certResult = await odooService.certifyStudent(studentData, examData)
    
    if (certResult.ok) {
      logger.info(`✅ [Async] Certificado generado: ${certResult.certificate.id}`)
      
      connection = await pool.getConnection()
      
      await connection.query(`
        UPDATE form_responses SET
          odoo_certificate_id = ?,
          odoo_certificate_pdf = ?
        WHERE id = ?
      `, [certResult.certificate.id, certResult.certificate.pdf_url, responseId])
      
      logger.info(`✅ [Async] Certificado guardado en BD para response_id: ${responseId}`)
    } else {
      logger.error(`❌ [Async] Error generando certificado: ${certResult.error}`)
    }
  } catch (error) {
    logger.error(`❌ [Async] Error en proceso de certificación:`, error)
  } finally {
    if (connection) connection.release()
  }
}