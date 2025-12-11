import pool from '../config/database.js'

export class NotificationController {

  // ═══════════════════════════════════════
  // LISTAR NOTIFICACIONES DEL USUARIO
  // ═══════════════════════════════════════
  static async list(req, reply) {
    const userId = req.user.id
    const { limit = 20, page = 1, unread_only = false } = req.query

    try {
      const conn = await pool.getConnection()
      try {
        let whereClause = 'user_id = ?'
        const params = [userId]

        if (unread_only === 'true' || unread_only === true) {
          whereClause += ' AND is_read = 0'
        }

        // Total
        const [[{ total }]] = await conn.query(
          `SELECT COUNT(*) as total FROM notifications WHERE ${whereClause}`,
          params
        )

        // Data
        const offset = (page - 1) * limit
        const [notifications] = await conn.query(`
          SELECT id, type, title, message, icon, is_read, link, metadata, created_at, read_at
          FROM notifications
          WHERE ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset])

        return reply.send({
          ok: true,
          data: {
            notifications,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              pages: Math.ceil(total / limit)
            }
          }
        })

      } finally {
        conn.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al obtener notificaciones' })
    }
  }

  // ═══════════════════════════════════════
  // CONTAR NO LEÍDAS
  // ═══════════════════════════════════════
  static async getUnreadCount(req, reply) {
    const userId = req.user.id

    try {
      const conn = await pool.getConnection()
      try {
        const [[{ count }]] = await conn.query(
          'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
          [userId]
        )

        return reply.send({ ok: true, data: { count } })

      } finally {
        conn.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al contar notificaciones' })
    }
  }

  // ═══════════════════════════════════════
  // MARCAR COMO LEÍDA
  // ═══════════════════════════════════════
  static async markAsRead(req, reply) {
    const userId = req.user.id
    const { id } = req.params

    try {
      const conn = await pool.getConnection()
      try {
        const [result] = await conn.query(
          'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
          [id, userId]
        )

        if (result.affectedRows === 0) {
          return reply.code(404).send({ ok: false, error: 'Notificación no encontrada' })
        }

        return reply.send({ ok: true, message: 'Notificación marcada como leída' })

      } finally {
        conn.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al actualizar notificación' })
    }
  }

  // ═══════════════════════════════════════
  // MARCAR TODAS COMO LEÍDAS
  // ═══════════════════════════════════════
  static async markAllAsRead(req, reply) {
    const userId = req.user.id

    try {
      const conn = await pool.getConnection()
      try {
        await conn.query(
          'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
          [userId]
        )

        return reply.send({ ok: true, message: 'Todas las notificaciones marcadas como leídas' })

      } finally {
        conn.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al actualizar notificaciones' })
    }
  }

  // ═══════════════════════════════════════
  // ELIMINAR NOTIFICACIÓN
  // ═══════════════════════════════════════
  static async delete(req, reply) {
    const userId = req.user.id
    const { id } = req.params

    try {
      const conn = await pool.getConnection()
      try {
        const [result] = await conn.query(
          'DELETE FROM notifications WHERE id = ? AND user_id = ?',
          [id, userId]
        )

        if (result.affectedRows === 0) {
          return reply.code(404).send({ ok: false, error: 'Notificación no encontrada' })
        }

        return reply.send({ ok: true, message: 'Notificación eliminada' })

      } finally {
        conn.release()
      }
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al eliminar notificación' })
    }
  }

  // ═══════════════════════════════════════
  // CREAR NOTIFICACIÓN (uso interno)
  // ═══════════════════════════════════════
  static async create(userId, { type = 'RESPONSE', title, message, icon = 'info', link = null, metadata = null }) {
    try {
      const conn = await pool.getConnection()
      try {
        const [result] = await conn.query(`
          INSERT INTO notifications (user_id, type, title, message, icon, link, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [userId, type, title, message, icon, link, metadata ? JSON.stringify(metadata) : null])

        return { ok: true, id: result.insertId }

      } finally {
        conn.release()
      }
    } catch (error) {
      console.error('Error al crear notificación:', error)
      return { ok: false, error: error.message }
    }
  }

  // ═══════════════════════════════════════
  // NOTIFICAR A ADMINS SOBRE NUEVA RESPUESTA
  // ═══════════════════════════════════════
  static async notifyNewResponse(formId, formTitle, responseId, respondentName, formUuid) {
    try {
      const conn = await pool.getConnection()
      try {
        // Obtener administradores (SUPER_ADMIN y ADMIN)
        const [admins] = await conn.query(`
          SELECT u.id FROM users u
          JOIN user_roles r ON u.role_id = r.id
          WHERE r.code IN ('SUPER_ADMIN', 'ADMIN') AND u.is_active = 1
        `)

        // Crear notificación para cada admin
        for (const admin of admins) {
          await NotificationController.create(admin.id, {
            type: 'RESPONSE',
            title: 'Nueva respuesta recibida',
            message: `${respondentName || 'Anónimo'} respondió "${formTitle}"`,
            icon: 'success',
            link: `/admin/forms/${formUuid}/responses`,
            metadata: { form_id: formId, response_id: responseId, form_uuid: formUuid }
          })
        }

        return { ok: true }

      } finally {
        conn.release()
      }
    } catch (error) {
      console.error('Error al notificar admins:', error)
      return { ok: false, error: error.message }
    }
  }
}