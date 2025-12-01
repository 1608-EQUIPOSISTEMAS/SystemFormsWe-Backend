import { ResponseController } from '../controllers/response.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function responseRoutes(fastify) {
  
  // ═══════════════════════════════════════
  // RUTA PÚBLICA - Enviar respuesta de formulario
  // ═══════════════════════════════════════
  fastify.post('/submit', ResponseController.submit)

  // ═══════════════════════════════════════
  // RUTAS PROTEGIDAS
  // ═══════════════════════════════════════
  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', authenticate)

    // Obtener una respuesta por ID
    protectedRoutes.get('/:id', ResponseController.getById)

    // Listar respuestas (admin)
    protectedRoutes.get('/', ResponseController.list)

    // Eliminar respuesta
    protectedRoutes.delete('/:id', ResponseController.delete)
  })
}