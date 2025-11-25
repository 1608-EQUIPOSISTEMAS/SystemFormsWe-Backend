import { AuthController } from '../controllers/auth.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function authRoutes(fastify) {
  // Rutas públicas
  fastify.post('/login', AuthController.login)
  fastify.post('/refresh', AuthController.refresh)

  // Rutas protegidas
  fastify.post('/me', { preHandler: authenticate }, AuthController.me)
  fastify.post('/logout', { preHandler: authenticate }, AuthController.logout)
  fastify.post('/change-password', { preHandler: authenticate }, AuthController.changePassword)
}