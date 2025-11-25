import { DashboardController } from '../controllers/dashboard.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function dashboardRoutes(fastify) {
  // Todas las rutas requieren autenticación
  fastify.addHook('preHandler', authenticate)
  
  fastify.get('/stats', DashboardController.getStats)
  fastify.get('/recent-forms', DashboardController.getRecentForms)
  fastify.get('/recent-activity', DashboardController.getRecentActivity)
}