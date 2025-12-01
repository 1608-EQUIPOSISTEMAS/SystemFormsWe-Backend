// src/routes/form.routes.js
import { FormController } from '../controllers/form.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function formRoutes(fastify) {
  // ═══════════════════════════════════════
  // RUTAS PÚBLICAS (sin autenticación)
  // ═══════════════════════════════════════
  fastify.get('/public/:uuid', FormController.getPublicForm)

  // ═══════════════════════════════════════
  // RUTAS PROTEGIDAS (requieren autenticación)
  // ═══════════════════════════════════════
  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', authenticate)

    // Tipos de preguntas (catálogo)
    protectedRoutes.get('/question-types', FormController.getQuestionTypes)

    // CRUD de formularios
    protectedRoutes.post('/', FormController.create)
    protectedRoutes.get('/', FormController.list)
    protectedRoutes.get('/:uuid', FormController.getByUuid)
    protectedRoutes.put('/:uuid', FormController.update)
    protectedRoutes.delete('/:uuid', FormController.delete)
    protectedRoutes.post('/:uuid/duplicate', FormController.duplicate)

    // ✅ Estadísticas del formulario
    protectedRoutes.get('/:uuid/stats', FormController.getStats)

    // ✅ Respuestas del formulario
    protectedRoutes.get('/:uuid/responses', FormController.getResponses)
    protectedRoutes.get('/:uuid/responses/export', FormController.exportResponses)
  })
}