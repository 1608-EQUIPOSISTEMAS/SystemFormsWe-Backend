import { FormController } from '../controllers/form.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function formRoutes(fastify) {
  // Todas requieren autenticación
  fastify.addHook('preHandler', authenticate)

  // Tipos de preguntas (catálogo)
  fastify.get('/question-types', FormController.getQuestionTypes)

  // CRUD de formularios
  fastify.post('/', FormController.create)
  fastify.get('/', FormController.list)
  fastify.get('/:uuid', FormController.getByUuid)
  fastify.put('/:uuid', FormController.update)
  fastify.delete('/:uuid', FormController.delete)
  fastify.post('/:uuid/duplicate', FormController.duplicate)
}