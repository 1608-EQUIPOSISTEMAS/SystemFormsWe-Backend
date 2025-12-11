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
import notificationRoutes from './notification.routes.js'
import syncRoutes from './sync.routes.js' 

export default async function routes(fastify) {
  fastify.register(publicRoutes, { prefix: '/public' })
  // Obtener certificado PDF (proxy público)

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

    api.register(notificationRoutes, { prefix: '/notifications' })
    
    api.register(syncRoutes, { prefix: '/sync' })

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