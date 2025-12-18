// src/routes/public.routes.js
import { FormController } from '../controllers/form.controller.js'
import { ResponseController } from '../controllers/response.controller.js'
import { pool } from '../config/database.js'

export default async function publicRoutes(fastify) {
  // Formulario público por UUID
  fastify.get('/forms/:uuid', FormController.getPublicForm)
  
  // Validar estudiante en Odoo
  fastify.post('/validate-student', ResponseController.validateStudent)
  
  // Enviar respuestas
  fastify.post('/responses/submit', ResponseController.submit)

  // ═══════════════════════════════════════
  // VERIFICAR RESPUESTA PREVIA CON LÓGICA DE 2 INTENTOS
  // ═══════════════════════════════════════
fastify.get('/check-previous-response', async (request, reply) => {
  const { form_uuid, respondent_email } = request.query

  console.log('🔍 CHECK PREVIOUS - Inicio', { form_uuid, respondent_email })

  if (!form_uuid || !respondent_email) {
    return reply.status(400).send({
      ok: false,
      error: 'Faltan parámetros: form_uuid y respondent_email son requeridos'
    })
  }

  let connection
  
  try {
    connection = await pool.getConnection()

    // 1. Obtener el formulario
    const [forms] = await connection.query(
      `SELECT id, uuid, form_type, passing_score, use_question_bank, questions_to_show, title
       FROM forms WHERE uuid = ? AND is_active = 1`,
      [form_uuid]
    )

    if (forms.length === 0) {
      return reply.status(404).send({ ok: false, error: 'Formulario no encontrado' })
    }

    const form = forms[0]

    // 2. Contar preguntas del formulario (para calcular totales)
    const [questionStats] = await connection.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(points), COUNT(*)) as total_points 
       FROM questions WHERE form_id = ? AND is_active = 1`,
      [form.id]
    )
    
    const formQuestionCount = parseInt(questionStats[0]?.count) || 0
    const formTotalPoints = parseFloat(questionStats[0]?.total_points) || formQuestionCount
    
    // Determinar total de preguntas (banco de preguntas o todas)
    const totalQuestionsInExam = (form.use_question_bank && form.questions_to_show) 
      ? parseInt(form.questions_to_show) 
      : formQuestionCount

    console.log('📊 Preguntas del examen:', totalQuestionsInExam)

    // 3. Buscar TODAS las respuestas previas del estudiante
    const [responses] = await connection.query(`
      SELECT 
        id,
        response_uuid,
        submitted_at,
        total_score,
        max_possible_score,
        percentage_score,
        passed,
        odoo_certificate_pdf,
        questions_shown
      FROM form_responses
      WHERE form_id = ? 
        AND LOWER(TRIM(respondent_email)) = LOWER(TRIM(?))
        AND status = 'SUBMITTED'
      ORDER BY submitted_at DESC
    `, [form.id, respondent_email])

    // 4. Si NO hay respuestas previas
    if (responses.length === 0) {
      return reply.send({
        ok: true,
        has_previous_response: false,
        can_take_exam: true,
        attempt_number: 0,
        all_attempts: []
      })
    }

    // 5. Función helper para calcular correct_count
    const calculateCorrectCount = async (response) => {
      // Primero intentar desde response_answers
      const [stats] = await connection.query(`
        SELECT 
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) as correct
        FROM response_answers WHERE response_id = ?
      `, [response.id])
      
      if (parseInt(stats[0]?.total) > 0) {
        return {
          correct_count: parseInt(stats[0].correct) || 0,
          total_questions: parseInt(stats[0].total) || 0
        }
      }
      
      // Fallback: calcular desde puntuación
      const totalScore = parseFloat(response.total_score) || 0
      const maxScore = parseFloat(response.max_possible_score) || 0
      const percentage = parseFloat(response.percentage_score) || 0
      
      let totalQ = totalQuestionsInExam
      let correctC = 0
      
      if (totalQ > 0 && maxScore > 0) {
        const pointsPerQuestion = maxScore / totalQ
        correctC = Math.round(totalScore / pointsPerQuestion)
      } else if (percentage > 0 && totalQ > 0) {
        correctC = Math.round((percentage / 100) * totalQ)
      }
      
      return { correct_count: correctC, total_questions: totalQ }
    }

    // 6. Procesar última respuesta
    const lastResponse = responses[0]
    const lastStats = await calculateCorrectCount(lastResponse)
    const attemptNumber = responses.length

    // 7. Procesar todos los intentos
    const allAttempts = []
    for (const r of responses) {
      const stats = await calculateCorrectCount(r)
      allAttempts.push({
        total_score: r.total_score || 0,
        max_score: r.max_possible_score || 0,
        correct_count: stats.correct_count,
        total_questions: stats.total_questions,
        score: r.percentage_score || 0,
        passed: Boolean(r.passed),
        submitted_at: r.submitted_at
      })
    }

    console.log('📊 Stats calculados:', lastStats)

    // 8. Si es EXAMEN
    if (form.form_type === 'EXAM') {
      // 8a. Si APROBÓ
      if (lastResponse.passed) {
        return reply.send({
          ok: true,
          has_previous_response: true,
          status: 'PASSED',
          can_take_exam: false,
          attempt_number: attemptNumber,
          all_attempts: allAttempts,
          data: {
            response_uuid: lastResponse.response_uuid,
            total_score: lastResponse.total_score || 0,
            max_score: lastResponse.max_possible_score || 0,
            correct_count: lastStats.correct_count,
            total_questions: lastStats.total_questions,
            score: lastResponse.percentage_score || 0,
            passed: true,
            passing_score: form.passing_score || 55,
            submitted_at: lastResponse.submitted_at,
            certificate_pdf: lastResponse.odoo_certificate_pdf || null,
            exam_title: form.title
          }
        })
      }

      // 8b. Si ya tiene 2+ intentos
      if (attemptNumber >= 2) {
        return reply.send({
          ok: true,
          has_previous_response: true,
          status: 'FAILED',
          can_take_exam: false,
          attempt_number: attemptNumber,
          all_attempts: allAttempts,
          data: {
            response_uuid: lastResponse.response_uuid,
            total_score: lastResponse.total_score || 0,
            max_score: lastResponse.max_possible_score || 0,
            correct_count: lastStats.correct_count,
            total_questions: lastStats.total_questions,
            score: lastResponse.percentage_score || 0,
            passed: false,
            passing_score: form.passing_score || 55,
            submitted_at: lastResponse.submitted_at,
            allow_retry: false,
            exam_title: form.title
          }
        })
      }

      // 8c. Puede reintentar
      return reply.send({
        ok: true,
        has_previous_response: true,
        status: 'FAILED',
        can_take_exam: true,
        attempt_number: attemptNumber,
        all_attempts: allAttempts,
        data: {
          response_uuid: lastResponse.response_uuid,
          total_score: lastResponse.total_score || 0,
          max_score: lastResponse.max_possible_score || 0,
          correct_count: lastStats.correct_count,
          total_questions: lastStats.total_questions,
          score: lastResponse.percentage_score || 0,
          passed: false,
          passing_score: form.passing_score || 55,
          submitted_at: lastResponse.submitted_at,
          allow_retry: true,
          exam_title: form.title
        }
      })
    }

    // 9. Si es ENCUESTA
    return reply.send({
      ok: true,
      has_previous_response: true,
      can_take_exam: false,
      attempt_number: attemptNumber,
      data: {
        response_uuid: lastResponse.response_uuid,
        submitted_at: lastResponse.submitted_at
      }
    })

  } catch (error) {
    console.error('❌ ERROR:', error.message)
    return reply.status(500).send({
      ok: false,
      error: 'Error al verificar respuesta previa',
      details: error.message
    })
  } finally {
    if (connection) connection.release()
  }
})
  
  // Obtener resultado
  fastify.get('/responses/:response_uuid/result', ResponseController.getResult)

  // Obtener certificado PDF
  fastify.get('/certificate/:responseUuid', ResponseController.getCertificatePdf)

  // Alias para obtener resultado
  fastify.get('/result/:response_uuid', ResponseController.getResult)
}