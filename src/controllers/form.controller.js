import { pool } from '../config/database.js'
import { v4 as uuidv4 } from 'uuid'

export class FormController {

  // ═══════════════════════════════════════
  // OBTENER TIPOS DE PREGUNTA (CATÁLOGO)
  // ═══════════════════════════════════════
  static async getQuestionTypes(req, reply) {
    try {
      const connection = await pool.getConnection()
      try {
        const [types] = await connection.query(`
          SELECT id, code, name, description, has_options 
          FROM question_types 
          WHERE is_active = 1 
          ORDER BY id
        `)
        return reply.send({ ok: true, data: { types } })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener tipos de pregunta' })
    }
  }

  static async duplicate(req, reply) {
  const { uuid } = req.params
  const userId = req.user?.id
  
  const connection = await pool.getConnection()
  
  try {
    await connection.beginTransaction()
    
    // Obtener formulario original
    const [forms] = await connection.query(
      'SELECT * FROM forms WHERE uuid = ?',
      [uuid]
    )
    
    if (!forms.length) {
      await connection.rollback()
      return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
    }
    
    const originalForm = forms[0]
    const newUuid = uuidv4()
    
    // Crear copia del formulario
    const [formResult] = await connection.query(`
      INSERT INTO forms (
        uuid, title, description, form_type, course_id,
        is_active, is_public, requires_login,
        allow_multiple_responses, show_progress_bar,
        shuffle_questions, passing_score,
        show_score_after_submit, show_correct_answers,
        welcome_message, submit_message, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      newUuid,
      `${originalForm.title} (copia)`,
      originalForm.description,
      originalForm.form_type,
      originalForm.course_id,
      0, // inactivo por defecto
      originalForm.is_public,
      originalForm.requires_login,
      originalForm.allow_multiple_responses,
      originalForm.show_progress_bar,
      originalForm.shuffle_questions,
      originalForm.passing_score,
      originalForm.show_score_after_submit,
      originalForm.show_correct_answers,
      originalForm.welcome_message,
      originalForm.submit_message,
      userId
    ])
    
    const newFormId = formResult.insertId
    
    // Copiar preguntas
    const [questions] = await connection.query(
      'SELECT * FROM questions WHERE form_id = ? ORDER BY display_order',
      [originalForm.id]
    )
    
    for (const question of questions) {
      const [qResult] = await connection.query(`
        INSERT INTO questions (
          form_id, section_id, question_type_id,
          question_text, help_text, placeholder,
          is_required, display_order, is_active,
          validation_rules, config, points
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newFormId,
        question.section_id,
        question.question_type_id,
        question.question_text,
        question.help_text,
        question.placeholder,
        question.is_required,
        question.display_order,
        question.is_active,
        question.validation_rules,
        question.config,
        question.points
      ])
      
      // Copiar opciones
      const [options] = await connection.query(
        'SELECT * FROM question_options WHERE question_id = ? ORDER BY display_order',
        [question.id]
      )
      
      for (const option of options) {
        await connection.query(`
          INSERT INTO question_options (
            question_id, option_text, option_value,
            display_order, is_correct, points
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          qResult.insertId,
          option.option_text,
          option.option_value,
          option.display_order,
          option.is_correct,
          option.points
        ])
      }
    }
    
    await connection.commit()
    
    return reply.send({
      ok: true,
      data: {
        uuid: newUuid,
        message: 'Formulario duplicado exitosamente'
      }
    })
    
  } catch (error) {
    await connection.rollback()
    req.log.error(error)
    return reply.code(500).send({ 
      ok: false, 
      error: 'Error al duplicar formulario' 
    })
  } finally {
    connection.release()
  }
}

  // ═══════════════════════════════════════
  // CREAR FORMULARIO
  // ═══════════════════════════════════════
  static async create(req, reply) {
    const userId = req.user?.id
    const { 
      title, 
      description, 
      form_type = 'SURVEY',
      course_id = null,
      is_public = false,
      requires_login = true,
      available_from = null,
      available_until = null,
      time_limit_minutes = null,
      passing_score = null,
      show_progress_bar = true,
      shuffle_questions = false,
      show_score_after_submit = false,
      show_correct_answers = false,
      welcome_message = null,
      submit_message = null,
      sections = [],
      questions = []
    } = req.body

    // Validaciones básicas
    if (!title || title.trim().length === 0) {
      return reply.code(400).send({ ok: false, error: 'El título es requerido' })
    }

    if (form_type === 'EXAM' && !course_id) {
      return reply.code(400).send({ ok: false, error: 'Los exámenes requieren un curso asociado' })
    }

    const connection = await pool.getConnection()
    
    try {
      await connection.beginTransaction()

      // 1. Crear el formulario
      const formUuid = uuidv4()
      const [formResult] = await connection.query(`
        INSERT INTO forms (
          uuid, title, description, form_type, course_id,
          is_active, is_public, requires_login,
          available_from, available_until, time_limit_minutes,
          passing_score, show_progress_bar, shuffle_questions,
          show_score_after_submit, show_correct_answers,
          welcome_message, submit_message, created_by
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        formUuid, title.trim(), description, form_type, course_id,
        is_public ? 1 : 0, requires_login ? 1 : 0,
        available_from, available_until, time_limit_minutes,
        passing_score, show_progress_bar ? 1 : 0, shuffle_questions ? 1 : 0,
        show_score_after_submit ? 1 : 0, show_correct_answers ? 1 : 0,
        welcome_message, submit_message, userId
      ])

      const formId = formResult.insertId

      // 2. Crear secciones si existen
      const sectionMap = new Map() // Para mapear índices temporales a IDs reales
      
      if (sections && sections.length > 0) {
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]
          const [sectionResult] = await connection.query(`
            INSERT INTO form_sections (form_id, title, description, display_order, is_active)
            VALUES (?, ?, ?, ?, 1)
          `, [formId, section.title, section.description || null, i])
          
          sectionMap.set(section.temp_id || i, sectionResult.insertId)
        }
      }

      // 3. Crear preguntas
      if (questions && questions.length > 0) {
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i]
          
          // Resolver section_id si viene referenciado
          let sectionId = null
          if (q.section_temp_id !== undefined && sectionMap.has(q.section_temp_id)) {
            sectionId = sectionMap.get(q.section_temp_id)
          } else if (q.section_id) {
            sectionId = q.section_id
          }

          const [questionResult] = await connection.query(`
            INSERT INTO questions (
              form_id, section_id, question_type_id, question_text,
              help_text, placeholder, is_required, display_order,
              validation_rules, config, points, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `, [
            formId,
            sectionId,
            q.question_type_id,
            q.question_text,
            q.help_text || null,
            q.placeholder || null,
            q.is_required ? 1 : 0,
            q.display_order ?? i,
            q.validation_rules ? JSON.stringify(q.validation_rules) : null,
            q.config ? JSON.stringify(q.config) : null,
            q.points || 0
          ])

          const questionId = questionResult.insertId

          // 4. Crear opciones si la pregunta las tiene
          if (q.options && q.options.length > 0) {
            for (let j = 0; j < q.options.length; j++) {
              const opt = q.options[j]
              await connection.query(`
                INSERT INTO question_options (
                  question_id, option_text, option_value,
                  display_order, is_correct, points, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, 1)
              `, [
                questionId,
                opt.option_text,
                opt.option_value || opt.option_text,
                j,
                opt.is_correct ? 1 : 0,
                opt.points || 0
              ])
            }
          }
        }
      }

      await connection.commit()

      return reply.code(201).send({
        ok: true,
        message: 'Formulario creado exitosamente',
        data: {
          id: formId,
          uuid: formUuid
        }
      })

    } catch (error) {
      await connection.rollback()
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al crear el formulario' })
    } finally {
      connection.release()
    }
  }

  // ═══════════════════════════════════════
  // LISTAR FORMULARIOS
  // ═══════════════════════════════════════
  static async list(req, reply) {
    const userId = req.user?.id
    const { page = 1, limit = 10, search = '', form_type = '' } = req.query

    try {
      const connection = await pool.getConnection()
      try {
        const offset = (page - 1) * limit
        
        let whereClause = 'WHERE f.created_by = ?'
        const params = [userId]

        if (search) {
          whereClause += ' AND f.title LIKE ?'
          params.push(`%${search}%`)
        }

        if (form_type) {
          whereClause += ' AND f.form_type = ?'
          params.push(form_type)
        }

        // Contar total
        const [countResult] = await connection.query(`
          SELECT COUNT(*) as total FROM forms f ${whereClause}
        `, params)

        // Obtener formularios
        const [forms] = await connection.query(`
          SELECT 
            f.id, f.uuid, f.title, f.description, f.form_type,
            f.is_active, f.is_public, f.created_at, f.updated_at,
            COUNT(DISTINCT q.id) as question_count,
            COUNT(DISTINCT fr.id) as response_count
          FROM forms f
          LEFT JOIN questions q ON f.id = q.form_id AND q.is_active = 1
          LEFT JOIN form_responses fr ON f.id = fr.form_id AND fr.status = 'SUBMITTED'
          ${whereClause}
          GROUP BY f.id
          ORDER BY f.created_at DESC
          LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset])

        return reply.send({
          ok: true,
          data: {
            forms,
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
      return reply.code(500).send({ ok: false, error: 'Error al listar formularios' })
    }
  }

  // ═══════════════════════════════════════
  // OBTENER FORMULARIO POR UUID
  // ═══════════════════════════════════════
  static async getByUuid(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id

    try {
      const connection = await pool.getConnection()
      try {
        // Obtener formulario
        const [forms] = await connection.query(`
          SELECT f.*, c.name as course_name
          FROM forms f
          LEFT JOIN courses c ON f.course_id = c.id
          WHERE f.uuid = ? AND f.created_by = ?
        `, [uuid, userId])

        if (forms.length === 0) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const form = forms[0]

        // Obtener secciones
        const [sections] = await connection.query(`
          SELECT id, title, description, display_order
          FROM form_sections
          WHERE form_id = ? AND is_active = 1
          ORDER BY display_order
        `, [form.id])

        // Obtener preguntas con tipo
        const [questions] = await connection.query(`
          SELECT 
            q.id, q.section_id, q.question_type_id, q.question_text,
            q.help_text, q.placeholder, q.is_required, q.display_order,
            q.validation_rules, q.config, q.points,
            qt.code as type_code, qt.name as type_name, qt.has_options
          FROM questions q
          JOIN question_types qt ON q.question_type_id = qt.id
          WHERE q.form_id = ? AND q.is_active = 1
          ORDER BY q.section_id, q.display_order
        `, [form.id])

        // Obtener opciones para cada pregunta
        const questionIds = questions.map(q => q.id)
        let options = []
        
        if (questionIds.length > 0) {
          const [opts] = await connection.query(`
            SELECT question_id, id, option_text, option_value, display_order, is_correct, points
            FROM question_options
            WHERE question_id IN (?) AND is_active = 1
            ORDER BY question_id, display_order
          `, [questionIds])
          options = opts
        }

        // Agrupar opciones por pregunta
        const optionsByQuestion = options.reduce((acc, opt) => {
          if (!acc[opt.question_id]) acc[opt.question_id] = []
          acc[opt.question_id].push(opt)
          return acc
        }, {})

        // Adjuntar opciones a preguntas
        const questionsWithOptions = questions.map(q => ({
          ...q,
          validation_rules: q.validation_rules ? JSON.parse(q.validation_rules) : null,
          config: q.config ? JSON.parse(q.config) : null,
          options: optionsByQuestion[q.id] || []
        }))

        return reply.send({
          ok: true,
          data: {
            form,
            sections,
            questions: questionsWithOptions
          }
        })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener formulario' })
    }
  }

  // ═══════════════════════════════════════
  // ACTUALIZAR FORMULARIO
  // ═══════════════════════════════════════
  static async update(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id
    const updates = req.body

    try {
      const connection = await pool.getConnection()
      try {
        // Verificar que existe y pertenece al usuario
        const [existing] = await connection.query(
          'SELECT id FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (existing.length === 0) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const formId = existing[0].id

        // Campos permitidos para actualizar
        const allowedFields = [
          'title', 'description', 'is_active', 'is_public', 'requires_login',
          'available_from', 'available_until', 'time_limit_minutes',
          'passing_score', 'show_progress_bar', 'shuffle_questions',
          'show_score_after_submit', 'show_correct_answers',
          'welcome_message', 'submit_message'
        ]

        const setClauses = []
        const values = []

        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            setClauses.push(`${field} = ?`)
            values.push(updates[field])
          }
        }

        if (setClauses.length > 0) {
          values.push(formId)
          await connection.query(
            `UPDATE forms SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = ?`,
            values
          )
        }

        return reply.send({ ok: true, message: 'Formulario actualizado' })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al actualizar formulario' })
    }
  }

  // ═══════════════════════════════════════
  // ELIMINAR FORMULARIO (soft delete)
  // ═══════════════════════════════════════
  static async delete(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id

    try {
      const connection = await pool.getConnection()
      try {
        const [result] = await connection.query(
          'UPDATE forms SET is_active = 0, updated_at = NOW() WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (result.affectedRows === 0) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        return reply.send({ ok: true, message: 'Formulario eliminado' })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al eliminar formulario' })
    }
  }


  // ═══════════════════════════════════════
// TOGGLE ACTIVO/INACTIVO
// ═══════════════════════════════════════
static async toggleActive(req, reply) {
  const { uuid } = req.params
  const userId = req.user?.id
  
  const connection = await pool.getConnection()
  
  try {
    // Obtener estado actual
    const [forms] = await connection.query(
      'SELECT id, is_active FROM forms WHERE uuid = ? AND created_by = ?',
      [uuid, userId]
    )
    
    if (!forms.length) {
      return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
    }
    
    const form = forms[0]
    const newStatus = !form.is_active
    
    // Actualizar estado
    await connection.query(
      'UPDATE forms SET is_active = ?, updated_at = NOW() WHERE id = ?',
      [newStatus ? 1 : 0, form.id]
    )
    
    return reply.send({ 
      ok: true, 
      data: { 
        is_active: newStatus 
      } 
    })
  } finally {
    connection.release()
  }
}

// ═══════════════════════════════════════
// OBTENER ESTADÍSTICAS
// ═══════════════════════════════════════
static async getStats(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id

    try {
      const connection = await pool.getConnection()
      try {
        const [forms] = await connection.query(
          'SELECT id, form_type FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (forms.length === 0) {
          return reply.code(404).send({ 
            ok: false, 
            error: 'Formulario no encontrado' 
          })
        }

        const formId = forms[0].id
        const isExam = forms[0].form_type === 'EXAM'

        // Estadísticas básicas + certificados
        const [stats] = await connection.query(`
          SELECT 
            COUNT(*) as total_responses,
            COUNT(CASE WHEN status = 'SUBMITTED' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as in_progress,
            AVG(CASE WHEN status = 'SUBMITTED' AND percentage_score IS NOT NULL THEN percentage_score END) as avg_score,
            MIN(submitted_at) as first_response,
            MAX(submitted_at) as last_response,
            COUNT(CASE WHEN odoo_certificate_pdf IS NOT NULL AND odoo_certificate_pdf != '' THEN 1 END) as certified
          FROM form_responses
          WHERE form_id = ?
        `, [formId])

        // Respuestas por día (últimos 7 días)
        const [daily] = await connection.query(`
          SELECT 
            DATE(submitted_at) as date,
            COUNT(*) as count
          FROM form_responses
          WHERE form_id = ? 
            AND submitted_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            AND status = 'SUBMITTED'
          GROUP BY DATE(submitted_at)
          ORDER BY date DESC
        `, [formId])

        let examStats = null
        if (isExam) {
          const [exam] = await connection.query(`
            SELECT 
              COUNT(CASE WHEN passed = 1 THEN 1 END) as passed,
              COUNT(CASE WHEN passed = 0 THEN 1 END) as failed,
              MAX(percentage_score) as highest_score,
              MIN(CASE WHEN percentage_score > 0 THEN percentage_score END) as lowest_score
            FROM form_responses
            WHERE form_id = ? AND status = 'SUBMITTED'
          `, [formId])
          examStats = exam[0]
        }

        return reply.send({
          ok: true,
          data: {
            total: stats[0].total_responses || 0,
            completed: stats[0].completed || 0,
            inProgress: stats[0].in_progress || 0,
            avgScore: stats[0].avg_score ? Math.round(stats[0].avg_score) : 0,
            firstResponse: stats[0].first_response,
            lastResponse: stats[0].last_response,
            certified: stats[0].certified || 0,
            dailyResponses: daily,
            ...(examStats && { 
              passed: examStats.passed || 0,
              failed: examStats.failed || 0,
              highestScore: examStats.highest_score,
              lowestScore: examStats.lowest_score
            })
          }
        })

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener estadísticas' 
      })
    }
  }

// ═══════════════════════════════════════
// OBTENER RESPUESTAS
// ═══════════════════════════════════════
static async getResponses(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id
    const { page = 1, limit = 20, status, search } = req.query

    try {
      const connection = await pool.getConnection()
      try {
        // Verificar formulario
        const [forms] = await connection.query(
          'SELECT id FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (forms.length === 0) {
          return reply.code(404).send({ 
            ok: false, 
            error: 'Formulario no encontrado' 
          })
        }

        const formId = forms[0].id
        const offset = (page - 1) * limit

        let whereClause = 'WHERE fr.form_id = ?'
        const params = [formId]

        if (status) {
          whereClause += ' AND fr.status = ?'
          params.push(status)
        }

        if (search) {
          whereClause += ` AND (
            fr.respondent_email LIKE ? 
            OR fr.odoo_student_names LIKE ? 
            OR fr.odoo_student_surnames LIKE ?
            OR u.email LIKE ?
          )`
          const searchTerm = `%${search}%`
          params.push(searchTerm, searchTerm, searchTerm, searchTerm)
        }

        // Contar total
        const [countResult] = await connection.query(`
          SELECT COUNT(*) as total 
          FROM form_responses fr
          LEFT JOIN users u ON fr.user_id = u.id
          ${whereClause}
        `, params)

        // Obtener respuestas - USANDO CAMPOS DE ODOO
        const [responses] = await connection.query(`
          SELECT 
            fr.id, 
            fr.response_uuid,
            fr.status, 
            fr.started_at, 
            fr.submitted_at,
            fr.total_score, 
            fr.max_possible_score,
            fr.percentage_score, 
            fr.passed,
            fr.odoo_certificate_pdf,
            fr.odoo_certificate_id,
            -- Prioridad: datos de Odoo > datos de user > email directo
            COALESCE(
              NULLIF(CONCAT_WS(' ', fr.odoo_student_names, fr.odoo_student_surnames), ''),
              CONCAT_WS(' ', u.first_name, u.last_name),
              'Anónimo'
            ) as respondent_name,
            COALESCE(fr.respondent_email, u.email) as respondent_email,
            TIMESTAMPDIFF(MINUTE, fr.started_at, fr.submitted_at) as duration_minutes
          FROM form_responses fr
          LEFT JOIN users u ON fr.user_id = u.id
          ${whereClause}
          ORDER BY fr.started_at DESC
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
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener respuestas' 
      })
    }
  }

// ═══════════════════════════════════════
// EXPORTAR RESPUESTAS
// ═══════════════════════════════════════
static async exportResponses(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id

    try {
      const connection = await pool.getConnection()
      try {
        // Verificar formulario
        const [forms] = await connection.query(
          'SELECT id, title FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (forms.length === 0) {
          return reply.code(404).send({ 
            ok: false, 
            error: 'Formulario no encontrado' 
          })
        }

        const formId = forms[0].id
        const formTitle = forms[0].title

        // Obtener preguntas
        const [questions] = await connection.query(`
          SELECT id, question_text, display_order
          FROM questions
          WHERE form_id = ? AND is_active = 1
          ORDER BY display_order
        `, [formId])

        // Obtener respuestas con detalle
        const [responses] = await connection.query(`
          SELECT 
            fr.id, fr.submitted_at, fr.total_score, fr.percentage_score,
            u.email, CONCAT(u.first_name, ' ', u.last_name) as name
          FROM form_responses fr
          LEFT JOIN users u ON fr.user_id = u.id
          WHERE fr.form_id = ? AND fr.status = 'SUBMITTED'
          ORDER BY fr.submitted_at DESC
        `, [formId])

        // Obtener todas las respuestas individuales
        const responseIds = responses.map(r => r.id)
        let answers = []
        
        if (responseIds.length > 0) {
          const [ans] = await connection.query(`
            SELECT response_id, question_id, answer_text
            FROM response_answers
            WHERE response_id IN (?)
          `, [responseIds])
          answers = ans
        }

        // Construir CSV
        const headers = ['Fecha', 'Email', 'Nombre', 'Puntuación']
        questions.forEach(q => headers.push(q.question_text))

        const rows = responses.map(r => {
          const row = [
            r.submitted_at ? new Date(r.submitted_at).toLocaleString('es-PE') : '',
            r.email || '',
            r.name || '',
            r.percentage_score !== null ? `${r.percentage_score}%` : ''
          ]

          questions.forEach(q => {
            const answer = answers.find(
              a => a.response_id === r.id && a.question_id === q.id
            )
            row.push(answer?.answer_text || '')
          })

          return row
        })

        // Generar CSV
        const csvContent = [
          headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
          ...rows.map(row => 
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
          )
        ].join('\n')

        reply.header('Content-Type', 'text/csv; charset=utf-8')
        reply.header(
          'Content-Disposition', 
          `attachment; filename="${formTitle.replace(/[^a-zA-Z0-9]/g, '_')}_respuestas.csv"`
        )
        
        return reply.send(csvContent)

      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al exportar respuestas' 
      })
    }
  }

// ═══════════════════════════════════════
// OBTENER FORMULARIO PÚBLICO (sin auth)
// ═══════════════════════════════════════
static async getPublicForm(req, reply) {
  const { uuid } = req.params

  try {
    const connection = await pool.getConnection()
    try {
      // Obtener formulario activo
      const [forms] = await connection.query(`
        SELECT 
          f.id, f.uuid, f.title, f.description, f.form_type,
          f.requires_login, f.show_progress_bar, f.shuffle_questions,
          f.welcome_message, f.submit_message, f.time_limit_minutes,
          f.available_from, f.available_until, f.is_active,
          f.passing_score,
          f.requires_odoo_validation
        FROM forms f
        WHERE f.uuid = ?
      `, [uuid])

      if (forms.length === 0) {
        return reply.code(404).send({ 
          ok: false, 
          error: 'Formulario no encontrado' 
        })
      }

      const form = forms[0]

      // Verificar si está activo
      if (!form.is_active) {
        return reply.code(403).send({ 
          ok: false, 
          error: 'Este formulario no está disponible actualmente' 
        })
      }

      // Verificar disponibilidad temporal
      const now = new Date()
      if (form.available_from && new Date(form.available_from) > now) {
        return reply.code(403).send({ 
          ok: false, 
          error: 'Este formulario aún no está disponible' 
        })
      }
      if (form.available_until && new Date(form.available_until) < now) {
        return reply.code(403).send({ 
          ok: false, 
          error: 'Este formulario ya no está disponible' 
        })
      }

      // Obtener preguntas con su tipo
      const [questions] = await connection.query(`
        SELECT 
          q.id, q.question_text, q.help_text, q.placeholder,
          q.is_required, q.display_order, q.config,
          qt.code as type_code, qt.name as type_name, qt.has_options
        FROM questions q
        JOIN question_types qt ON q.question_type_id = qt.id
        WHERE q.form_id = ? AND q.is_active = 1
        ORDER BY q.display_order
      `, [form.id])

      // Obtener opciones para preguntas que las tienen
      const questionIds = questions.map(q => q.id)
      let options = []
      
      if (questionIds.length > 0) {
        const [opts] = await connection.query(`
          SELECT question_id, id, option_text, option_value, display_order
          FROM question_options
          WHERE question_id IN (?) AND is_active = 1
          ORDER BY display_order
        `, [questionIds])
        options = opts
      }

      // Adjuntar opciones a cada pregunta
      const questionsWithOptions = questions.map(q => ({
        id: q.id,
        question_text: q.question_text,
        help_text: q.help_text,
        placeholder: q.placeholder,
        is_required: !!q.is_required,
        display_order: q.display_order,
        type: q.type_code,
        type_code: q.type_code,
        type_name: q.type_name,
        has_options: !!q.has_options,
        config: q.config ? JSON.parse(q.config) : null,
        options: options
          .filter(o => o.question_id === q.id)
          .map(o => ({
            id: o.id,
            option_text: o.option_text,
            option_value: o.option_value
          }))
      }))

      return reply.send({
        ok: true,
        data: {
          form: {
            uuid: form.uuid,
            title: form.title,
            description: form.description,
            form_type: form.form_type,
            requires_login: !!form.requires_login,
            show_progress_bar: !!form.show_progress_bar,
            shuffle_questions: !!form.shuffle_questions,
            welcome_message: form.welcome_message,
            submit_message: form.submit_message,
            time_limit_minutes: form.time_limit_minutes,
            passing_score: form.passing_score,
            requires_odoo_validation: !!form.requires_odoo_validation
          },
          questions: questionsWithOptions
        }
      })

    } finally {
      connection.release()
    }
  } catch (error) {
    req.log.error(error)
    return reply.code(500).send({ 
      ok: false, 
      error: 'Error al obtener formulario' 
    })
  }
}
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function convertToCSV(data) {
  if (!data.length) return ''
  
  // Headers
  const headers = [
    'ID Respuesta',
    'Email',
    'Nombre',
    'Estado',
    'Fecha Inicio',
    'Fecha Envío',
    'Tiempo (min)',
    'Puntuación (%)',
    'Aprobado',
    'Pregunta',
    'Respuesta'
  ]
  
  // Agrupar por respuesta
  const responseMap = {}
  data.forEach(row => {
    if (!responseMap[row.response_id]) {
      responseMap[row.response_id] = {
        base: {
          response_id: row.response_id,
          respondent_email: row.respondent_email || '',
          respondent_name: row.respondent_name || '',
          status: row.status,
          started_at: row.started_at,
          submitted_at: row.submitted_at,
          completion_time_minutes: row.completion_time_minutes || '',
          percentage_score: row.percentage_score || '',
          passed: row.passed ? 'Sí' : 'No'
        },
        answers: []
      }
    }
    
    if (row.question_text) {
      let answer = row.answer_text || ''
      if (row.answer_number !== null) answer = row.answer_number
      if (row.answer_date) answer = row.answer_date
      if (row.selected_options) answer = JSON.parse(row.selected_options).join(', ')
      
      responseMap[row.response_id].answers.push({
        question: row.question_text,
        answer: answer
      })
    }
  })
  
  // Construir filas CSV
  const rows = [headers.join(',')]
  
  Object.values(responseMap).forEach(response => {
    const base = response.base
    response.answers.forEach((qa, index) => {
      const row = [
        base.response_id,
        `"${base.respondent_email}"`,
        `"${base.respondent_name}"`,
        base.status,
        formatDate(base.started_at),
        formatDate(base.submitted_at),
        base.completion_time_minutes,
        base.percentage_score,
        base.passed,
        `"${qa.question}"`,
        `"${qa.answer}"`
      ]
      rows.push(row.join(','))
    })
  })
  
  return rows.join('\n')
}

function formatDate(date) {
  if (!date) return ''
  return new Date(date).toLocaleString('es-PE')
}



