// src/routes/sync.routes.js
import { SyncController } from '../controllers/sync.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

export default async function syncRoutes(fastify) {
  // Todas las rutas requieren autenticación
  fastify.addHook('preHandler', authenticate)

  // POST /sync/programs - Sincronización manual
  // POST /sync/programs?full=true - Sync completo
  fastify.post('/programs', SyncController.syncPrograms)

  // GET /sync/status - Estado de conexión W|E
  fastify.get('/status', SyncController.getStatus)
}