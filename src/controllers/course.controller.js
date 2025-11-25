import { pool } from '../config/database.js'

export class CourseController {
  
  static async list(req, reply) {
    try {
      const connection = await pool.getConnection()
      try {
        const [courses] = await connection.query(`
          SELECT id, code, name, instructor_name, start_date, end_date, is_active
          FROM courses
          WHERE is_active = 1
          ORDER BY name
        `)
        
        return reply.send({ 
          ok: true, 
          data: { courses } 
        })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al obtener cursos' 
      })
    }
  }
}