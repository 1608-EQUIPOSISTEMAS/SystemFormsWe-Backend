import { pool } from '../config/database.js'
import { v4 as uuidv4 } from 'uuid'

// ═══════════════════════════════════════
// HELPER: PARSEO SEGURO DE JSON
// ═══════════════════════════════════════
function safeJsonParse(value) {
  if (!value) return null
  if (typeof value === 'object') return value // Ya es objeto
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

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
        0,
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
      return reply.code(500).send({ ok: false, error: 'Error al duplicar formulario' })
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

    if (!title || title.trim().length === 0) {
      return reply.code(400).send({ ok: false, error: 'El título es requerido' })
    }

    if (form_type === 'EXAM' && !course_id) {
      return reply.code(400).send({ ok: false, error: 'Los exámenes requieren un curso asociado' })
    }

    const connection = await pool.getConnection()
    
    try {
      await connection.beginTransaction()

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

      const sectionMap = new Map()
      
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

      if (questions && questions.length > 0) {
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i]
          
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
        data: { id: formId, uuid: formUuid }
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

        const [countResult] = await connection.query(`
          SELECT COUNT(*) as total FROM forms f ${whereClause}
        `, params)

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

        const [sections] = await connection.query(`
          SELECT id, title, description, display_order
          FROM form_sections
          WHERE form_id = ? AND is_active = 1
          ORDER BY display_order
        `, [form.id])

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

        const optionsByQuestion = options.reduce((acc, opt) => {
          if (!acc[opt.question_id]) acc[opt.question_id] = []
          acc[opt.question_id].push(opt)
          return acc
        }, {})

        // ✅ CORREGIDO: Usar safeJsonParse
        const questionsWithOptions = questions.map(q => ({
          ...q,
          validation_rules: safeJsonParse(q.validation_rules),
          config: safeJsonParse(q.config),
          options: optionsByQuestion[q.id] || []
        }))

        return reply.send({
          ok: true,
          data: { form, sections, questions: questionsWithOptions }
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
        const [existing] = await connection.query(
          'SELECT id FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (existing.length === 0) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const formId = existing[0].id

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
      const [forms] = await connection.query(
        'SELECT id, is_active FROM forms WHERE uuid = ? AND created_by = ?',
        [uuid, userId]
      )
      
      if (!forms.length) {
        return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
      }
      
      const form = forms[0]
      const newStatus = !form.is_active
      
      await connection.query(
        'UPDATE forms SET is_active = ?, updated_at = NOW() WHERE id = ?',
        [newStatus ? 1 : 0, form.id]
      )
      
      return reply.send({ ok: true, data: { is_active: newStatus } })
    } finally {
      connection.release()
    }
  }

  static async update(req, reply) {
    const { uuid } = req.params
    const userId = req.user?.id
    const { 
      title,
      description,
      settings = {},
      questions = []
    } = req.body

    const connection = await pool.getConnection()
    
    try {
      await connection.beginTransaction()

      // 1. Verificar que el formulario existe y pertenece al usuario
      const [forms] = await connection.query(
        'SELECT id, form_type FROM forms WHERE uuid = ? AND created_by = ?',
        [uuid, userId]
      )

      if (forms.length === 0) {
        await connection.rollback()
        return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
      }

      const formId = forms[0].id
      const formType = forms[0].form_type

      // 2. Actualizar datos del formulario
      const formFields = {
        title: title?.trim(),
        description: description || null,
        is_active: settings.is_active !== undefined ? (settings.is_active ? 1 : 0) : undefined,
        is_public: settings.is_public !== undefined ? (settings.is_public ? 1 : 0) : undefined,
        requires_login: settings.requires_login !== undefined ? (settings.requires_login ? 1 : 0) : undefined,
        available_from: settings.available_from || null,
        available_until: settings.available_until || null,
        time_limit_minutes: settings.time_limit_minutes || null,
        allow_multiple_responses: settings.allow_multiple_responses !== undefined ? (settings.allow_multiple_responses ? 1 : 0) : undefined,
        show_progress_bar: settings.show_progress_bar !== undefined ? (settings.show_progress_bar ? 1 : 0) : undefined,
        shuffle_questions: settings.shuffle_questions !== undefined ? (settings.shuffle_questions ? 1 : 0) : undefined,
        passing_score: settings.passing_score || null,
        show_score_after_submit: settings.show_score_after_submit !== undefined ? (settings.show_score_after_submit ? 1 : 0) : undefined,
        show_correct_answers: settings.show_correct_answers !== undefined ? (settings.show_correct_answers ? 1 : 0) : undefined,
        welcome_message: settings.welcome_message || null,
        submit_message: settings.submit_message || null
      }

      // Construir query de actualización
      const setClauses = []
      const values = []

      for (const [field, value] of Object.entries(formFields)) {
        if (value !== undefined) {
          setClauses.push(`${field} = ?`)
          values.push(value)
        }
      }

      if (setClauses.length > 0) {
        values.push(formId)
        await connection.query(
          `UPDATE forms SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = ?`,
          values
        )
      }

      // 3. Procesar preguntas
      if (questions.length > 0) {
        // Obtener IDs de preguntas existentes
        const [existingQuestions] = await connection.query(
          'SELECT id FROM questions WHERE form_id = ?',
          [formId]
        )
        const existingIds = existingQuestions.map(q => q.id)
        const incomingIds = questions.filter(q => q.id).map(q => q.id)
        
        // Eliminar preguntas que ya no existen
        const toDelete = existingIds.filter(id => !incomingIds.includes(id))
        if (toDelete.length > 0) {
          // Primero eliminar opciones
          await connection.query(
            'DELETE FROM question_options WHERE question_id IN (?)',
            [toDelete]
          )
          // Luego eliminar preguntas
          await connection.query(
            'DELETE FROM questions WHERE id IN (?)',
            [toDelete]
          )
        }

        // Procesar cada pregunta
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i]
          let questionId = q.id

          if (questionId) {
            // Actualizar pregunta existente
            await connection.query(`
              UPDATE questions SET
                question_text = ?,
                help_text = ?,
                placeholder = ?,
                is_required = ?,
                display_order = ?,
                points = ?,
                validation_rules = ?,
                config = ?,
                updated_at = NOW()
              WHERE id = ? AND form_id = ?
            `, [
              q.question_text,
              q.help_text || null,
              q.placeholder || null,
              q.is_required ? 1 : 0,
              i,
              q.points || 0,
              q.validation_rules ? JSON.stringify(q.validation_rules) : null,
              q.config ? JSON.stringify(q.config) : null,
              questionId,
              formId
            ])
          } else {
            // Crear nueva pregunta
            const [result] = await connection.query(`
              INSERT INTO questions (
                form_id, question_type_id, question_text, help_text,
                placeholder, is_required, display_order, points,
                validation_rules, config
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              formId,
              q.question_type_id,
              q.question_text,
              q.help_text || null,
              q.placeholder || null,
              q.is_required ? 1 : 0,
              i,
              q.points || 0,
              q.validation_rules ? JSON.stringify(q.validation_rules) : null,
              q.config ? JSON.stringify(q.config) : null
            ])
            questionId = result.insertId
          }

          // 4. Procesar opciones si la pregunta las tiene
          if (q.has_options && q.options?.length > 0) {
            // Obtener opciones existentes
            const [existingOptions] = await connection.query(
              'SELECT id FROM question_options WHERE question_id = ?',
              [questionId]
            )
            const existingOptIds = existingOptions.map(o => o.id)
            const incomingOptIds = q.options.filter(o => o.id).map(o => o.id)
            
            // Eliminar opciones que ya no existen
            const optsToDelete = existingOptIds.filter(id => !incomingOptIds.includes(id))
            if (optsToDelete.length > 0) {
              await connection.query(
                'DELETE FROM question_options WHERE id IN (?)',
                [optsToDelete]
              )
            }

            // Procesar cada opción
            for (let j = 0; j < q.options.length; j++) {
              const opt = q.options[j]
              
              if (opt.id && !opt.temp_id?.startsWith('opt_')) {
                // Actualizar opción existente
                await connection.query(`
                  UPDATE question_options SET
                    option_text = ?,
                    option_value = ?,
                    display_order = ?,
                    is_correct = ?,
                    points = ?
                  WHERE id = ? AND question_id = ?
                `, [
                  opt.option_text,
                  opt.option_value || opt.option_text,
                  j,
                  opt.is_correct ? 1 : 0,
                  opt.points || 0,
                  opt.id,
                  questionId
                ])
              } else {
                // Crear nueva opción
                await connection.query(`
                  INSERT INTO question_options (
                    question_id, option_text, option_value,
                    display_order, is_correct, points
                  ) VALUES (?, ?, ?, ?, ?, ?)
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
      }

      await connection.commit()

      return reply.send({
        ok: true,
        message: 'Formulario actualizado correctamente'
      })

    } catch (error) {
      await connection.rollback()
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al actualizar formulario' 
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
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const formId = forms[0].id
        const isExam = forms[0].form_type === 'EXAM'

        const [stats] = await connection.query(`
          SELECT 
            COUNT(*) as total_responses,
            COUNT(CASE WHEN status = 'SUBMITTED' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as in_progress,
            AVG(CASE WHEN status = 'SUBMITTED' THEN percentage_score END) as avg_score,
            MIN(submitted_at) as first_response,
            MAX(submitted_at) as last_response,
            COUNT(CASE WHEN odoo_certificate_pdf IS NOT NULL AND odoo_certificate_pdf != '' THEN 1 END) as certified
          FROM form_responses
          WHERE form_id = ?
        `, [formId])

        const daily = []

        let examStats = null
        if (isExam) {
          const [exam] = await connection.query(`
            SELECT 
              COUNT(CASE WHEN passed = 1 THEN 1 END) as passed,
              COUNT(CASE WHEN passed = 0 THEN 1 END) as failed,
              MAX(percentage_score) as highest_score,
              MIN(percentage_score) as lowest_score
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
            avgScore: stats[0].avg_score ? Math.round(stats[0].avg_score) : null,
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
      return reply.code(500).send({ ok: false, error: 'Error al obtener estadísticas' })
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
        const [forms] = await connection.query(
          'SELECT id FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (forms.length === 0) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
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

        const [countResult] = await connection.query(`
          SELECT COUNT(*) as total 
          FROM form_responses fr
          LEFT JOIN users u ON fr.user_id = u.id
          ${whereClause}
        `, params)

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
      return reply.code(500).send({ ok: false, error: 'Error al obtener respuestas' })
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
        const [forms] = await connection.query(
          'SELECT id, title FROM forms WHERE uuid = ? AND created_by = ?',
          [uuid, userId]
        )

        if (forms.length === 0) {
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const formId = forms[0].id
        const formTitle = forms[0].title

        const [questions] = await connection.query(`
          SELECT id, question_text, display_order
          FROM questions
          WHERE form_id = ? AND is_active = 1
          ORDER BY display_order
        `, [formId])

        const [responses] = await connection.query(`
          SELECT 
            fr.id, fr.submitted_at, fr.total_score, fr.percentage_score,
            u.email, CONCAT(u.first_name, ' ', u.last_name) as name
          FROM form_responses fr
          LEFT JOIN users u ON fr.user_id = u.id
          WHERE fr.form_id = ? AND fr.status = 'SUBMITTED'
          ORDER BY fr.submitted_at DESC
        `, [formId])

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
      return reply.code(500).send({ ok: false, error: 'Error al exportar respuestas' })
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
          return reply.code(404).send({ ok: false, error: 'Formulario no encontrado' })
        }

        const form = forms[0]

        if (!form.is_active) {
          return reply.code(403).send({ ok: false, error: 'Este formulario no está disponible actualmente' })
        }

        const now = new Date()
        if (form.available_from && new Date(form.available_from) > now) {
          return reply.code(403).send({ ok: false, error: 'Este formulario aún no está disponible' })
        }
        if (form.available_until && new Date(form.available_until) < now) {
          return reply.code(403).send({ ok: false, error: 'Este formulario ya no está disponible' })
        }

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

        // ✅ CORREGIDO: Usar safeJsonParse
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
          config: safeJsonParse(q.config),
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
      return reply.code(500).send({ ok: false, error: 'Error al obtener formulario' })
    }
  }

  static async getResponseDetail(req, reply) {
    const { uuid, responseId } = req.params
    const userId = req.user?.id

    try {
      const connection = await pool.getConnection()
      try {
        // Verificar que el formulario pertenece al usuario
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

        // Obtener la respuesta
        const [responses] = await connection.query(`
          SELECT 
            fr.id,
            fr.response_uuid,
            fr.status,
            fr.started_at,
            fr.submitted_at,
            fr.respondent_email,
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(fr.odoo_student_names, ''), ' ', COALESCE(fr.odoo_student_surnames, ''))), ''),
              NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
              fr.respondent_email,
              'Anónimo'
            ) as respondent_name,
            fr.total_score,
            fr.max_possible_score,
            fr.percentage_score,
            fr.passed,
            fr.duration_minutes,
            fr.odoo_certificate_pdf
          FROM form_responses fr
          LEFT JOIN users u ON fr.user_id = u.id
          WHERE fr.id = ? AND fr.form_id = ?
        `, [responseId, formId])

        if (responses.length === 0) {
          return reply.code(404).send({ 
            ok: false, 
            error: 'Respuesta no encontrada' 
          })
        }

        const response = responses[0]

        // Obtener TODAS las preguntas del formulario con sus respuestas (si existen)
        const [questionsWithAnswers] = await connection.query(`
          SELECT 
            q.id as question_id,
            q.uuid as question_uuid,
            q.question_text,
            qt.code as question_type,
            q.points as max_points,
            q.display_order,
            q.is_required,
            ra.id as answer_id,
            ra.answer_text,
            ra.answer_number,
            ra.answer_date,
            ra.is_correct,
            ra.points_earned
          FROM questions q
          LEFT JOIN question_types qt ON q.question_type_id = qt.id
          LEFT JOIN response_answers ra ON ra.question_id = q.id AND ra.response_id = ?
          WHERE q.form_id = ? AND q.is_active = 1
          ORDER BY q.display_order ASC
        `, [response.id, formId])

        // Construir el array de answers
        const answers = []
        
        for (const row of questionsWithAnswers) {
          const answer = {
            question_id: row.question_id,
            question_uuid: row.question_uuid,
            question_text: row.question_text,
            question_type: row.question_type,
            max_points: row.max_points,
            display_order: row.display_order,
            is_required: row.is_required,
            // Datos de la respuesta (pueden ser null si no respondió)
            answer_text: row.answer_text,
            answer_number: row.answer_number,
            answer_date: row.answer_date,
            is_correct: row.is_correct,
            points_earned: row.points_earned,
            selected_options: []
          }

          // Si hay respuesta y es tipo múltiple, obtener opciones seleccionadas
          if (row.answer_id) {
            const [selectedOptions] = await connection.query(`
              SELECT qo.option_text
              FROM response_answer_options rao
              JOIN question_options qo ON rao.option_id = qo.id
              WHERE rao.answer_id = ?
            `, [row.answer_id])

            answer.selected_options = selectedOptions.map(o => o.option_text)
          }

          answers.push(answer)
        }

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
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener detalle de respuesta' 
      })
    }
  }
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function convertToCSV(data) {
  if (!data.length) return ''
  
  const headers = [
    'ID Respuesta', 'Email', 'Nombre', 'Estado',
    'Fecha Inicio', 'Fecha Envío', 'Tiempo (min)',
    'Puntuación (%)', 'Aprobado', 'Pregunta', 'Respuesta'
  ]
  
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
      if (row.selected_options) {
        const parsed = safeJsonParse(row.selected_options)
        if (Array.isArray(parsed)) answer = parsed.join(', ')
      }
      
      responseMap[row.response_id].answers.push({
        question: row.question_text,
        answer: answer
      })
    }
  })
  
  const rows = [headers.join(',')]
  
  Object.values(responseMap).forEach(response => {
    const base = response.base
    response.answers.forEach((qa) => {
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