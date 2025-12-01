import uploadRoutes from './upload.routes.js'
import fileRoutes from './file.routes.js'
import inscripcionRoutes from './inscripcion.routes.js'
import authRoutes from './auth.routes.js'
import dashboardRoutes from './dashboard.routes.js'
import formRoutes from './form.routes.js'
import courseRoutes from './course.routes.js'
import responseRoutes from './response.routes.js'
import linkedinRoutes from './linkedin.routes.js'
import publicRoutes from './public.routes.js'

export default async function routes(fastify) {
  fastify.register(publicRoutes, { prefix: '/public' })

  fastify.register(async (api) => {
    // Auth
    api.register(authRoutes, { prefix: '/auth' })

    // Dashboard
    api.register(dashboardRoutes, { prefix: '/dashboard' })

    api.register(linkedinRoutes, { prefix: '/linkedin' })

    // Formularios
    api.register(formRoutes, { prefix: '/forms' })

    // Respuestas individuales
    api.register(responseRoutes, { prefix: '/responses' })

    // Cursos
    api.register(courseRoutes, { prefix: '/courses' })
    
    // Formulario público (existentes)
    api.register(uploadRoutes, { prefix: '/upload' })
    api.register(fileRoutes, { prefix: '/file' })
    api.register(inscripcionRoutes, { prefix: '/inscripcion' })
  }, { prefix: '' })

  // Health check
  fastify.get('/health', async () => ({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }))
}