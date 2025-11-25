import { pool } from '../config/database.js'

export class DashboardController {
  
  static async getStats(req, reply) {
    try {
      // Usar el usuario del token si existe, sino null
      const userId = req.user?.id || null
      
      // Estadísticas actuales
      const [formsResult] = await pool.query(
        'SELECT COUNT(*) as total FROM forms WHERE created_by = ? OR ? IS NULL',
        [userId, userId]
      )
      
      const [responsesResult] = await pool.query(
        `SELECT COUNT(*) as total FROM form_responses fr
         JOIN forms f ON fr.form_id = f.id
         WHERE f.created_by = ? OR ? IS NULL`,
        [userId, userId]
      )
      
      const [templatesResult] = await pool.query(
        'SELECT COUNT(*) as total FROM form_templates WHERE created_by = ? OR visibility = "PUBLIC"',
        [userId]
      )
      
      const [usersResult] = await pool.query(
        'SELECT COUNT(*) as total FROM users WHERE is_active = 1'
      )
      
      // Estructura que espera el frontend
      return reply.send({
        ok: true,
        data: {
          stats: {
            forms: Number(formsResult[0]?.total) || 0,
            responses: Number(responsesResult[0]?.total) || 0,
            templates: Number(templatesResult[0]?.total) || 0,
            users: Number(usersResult[0]?.total) || 0
          },
          trends: {
            forms: 0,
            responses: 0,
            templates: 0,
            users: 0
          }
        }
      })
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener estadísticas' 
      })
    }
  }
  
  static async getRecentForms(req, reply) {
    try {
      const userId = req.user?.id || null
      const limit = parseInt(req.query.limit) || 5
      
      const [forms] = await pool.query(
        `SELECT 
          f.id,
          f.uuid,
          f.title,
          f.form_type,
          f.is_active,
          f.created_at,
          (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as responses,
          (SELECT COUNT(*) FROM questions WHERE form_id = f.id AND is_active = 1) as question_count
         FROM forms f
         WHERE f.created_by = ? OR ? IS NULL
         ORDER BY f.created_at DESC
         LIMIT ?`,
        [userId, userId, limit]
      )
      
      // Estructura que espera el frontend
      return reply.send({
        ok: true,
        data: { 
          forms: forms.map(f => ({
            ...f,
            responses: Number(f.responses) || 0
          }))
        }
      })
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener formularios recientes' 
      })
    }
  }
  
  static async getRecentActivity(req, reply) {
    try {
      const userId = req.user?.id || null
      const limit = parseInt(req.query.limit) || 8
      
      const [rows] = await pool.query(
        `SELECT 
          fr.id,
          'response_received' as type,
          f.title as form_title,
          fr.status,
          fr.submitted_at as date,
          fr.created_at,
          COALESCE(u.email, fr.respondent_email, 'Anónimo') as user_email
         FROM form_responses fr
         JOIN forms f ON fr.form_id = f.id
         LEFT JOIN users u ON fr.user_id = u.id
         WHERE f.created_by = ? OR ? IS NULL
         ORDER BY fr.created_at DESC
         LIMIT ?`,
        [userId, userId, limit]
      )
      
      // Formatear para el frontend
      const activities = rows.map(row => ({
        id: row.id,
        type: row.type,
        message: `Nueva respuesta en "${row.form_title}" por ${row.user_email}`,
        time: formatTimeAgo(row.created_at)
      }))
      
      return reply.send({
        ok: true,
        data: { activities }
      })
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener actividad reciente' 
      })
    }
  }
}

// Helper para formato de tiempo
function formatTimeAgo(date) {
  if (!date) return ''
  const now = new Date()
  const diff = now - new Date(date)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `Hace ${days} día${days > 1 ? 's' : ''}`
  if (hours > 0) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`
  if (minutes > 0) return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`
  return 'Hace un momento'
}