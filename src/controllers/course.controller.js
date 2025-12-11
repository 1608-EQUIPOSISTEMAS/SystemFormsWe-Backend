// src/controllers/course.controller.js
import { pool } from '../config/database.js'

export class CourseController {
  
  // GET /courses
  static async list(req, reply) {
    try {
      const connection = await pool.getConnection()
      try {
        const [courses] = await connection.query(`
          SELECT 
            id, code, name, description,
            instructor_name, start_date, end_date, is_active,
            CASE WHEN code LIKE 'WE-%' THEN 'W|E' ELSE 'LOCAL' END as source
          FROM courses
          WHERE is_active = 1
          ORDER BY name
        `)
        
        return reply.send({ ok: true, data: { courses } })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener cursos' })
    }
  }

  // GET /courses/:id
  static async getById(req, reply) {
    try {
      const { id } = req.params
      const connection = await pool.getConnection()
      
      try {
        const [courses] = await connection.query(
          'SELECT * FROM courses WHERE id = ?', [id]
        )
        
        if (!courses.length) {
          return reply.code(404).send({ ok: false, error: 'Curso no encontrado' })
        }
        
        return reply.send({ ok: true, data: { course: courses[0] } })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener curso' })
    }
  }

  // PUT /courses/:id
  static async update(req, reply) {
    try {
      const { id } = req.params
      const { description, instructor_name, start_date, end_date } = req.body
      
      const connection = await pool.getConnection()
      
      try {
        await connection.query(`
          UPDATE courses SET 
            description = COALESCE(?, description),
            instructor_name = COALESCE(?, instructor_name),
            start_date = COALESCE(?, start_date),
            end_date = COALESCE(?, end_date)
          WHERE id = ?
        `, [description, instructor_name, start_date, end_date, id])
        
        return reply.send({ ok: true, message: 'Curso actualizado' })
      } finally {
        connection.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al actualizar' })
    }
  }
}