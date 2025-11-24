import uploadRoutes from './upload.routes.js'
import fileRoutes from './file.routes.js'
import inscripcionRoutes from './inscripcion.routes.js'

export default async function routes(fastify) {
  fastify.register(uploadRoutes, { prefix: '/upload' })
  fastify.register(fileRoutes, { prefix: '/file' })
  fastify.register(inscripcionRoutes, { prefix: '/inscripcion' })
  
  // Health check
  fastify.get('/health', async () => ({ ok: true }))
}