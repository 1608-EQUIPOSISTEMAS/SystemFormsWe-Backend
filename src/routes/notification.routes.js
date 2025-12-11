import { NotificationController } from '../controllers/notification.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function notificationRoutes(fastify) {
  // Todas las rutas requieren autenticación
  fastify.addHook('preHandler', authenticate)

  // Obtener notificaciones del usuario
  fastify.get('/', NotificationController.list)

  // Contar no leídas
  fastify.get('/unread-count', NotificationController.getUnreadCount)

  // Marcar una como leída
  fastify.patch('/:id/read', NotificationController.markAsRead)

  // Marcar todas como leídas
  fastify.patch('/read-all', NotificationController.markAllAsRead)

  // Eliminar notificación
  fastify.delete('/:id', NotificationController.delete)
}