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
}