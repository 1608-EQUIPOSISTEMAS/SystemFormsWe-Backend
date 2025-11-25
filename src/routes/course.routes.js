import { CourseController } from '../controllers/course.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function courseRoutes(fastify) {
  fastify.addHook('preHandler', authenticate)
  
  fastify.get('/', CourseController.list)
}