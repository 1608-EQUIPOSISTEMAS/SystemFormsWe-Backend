import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { config } from './config/env.js'
import routes from './routes/index.js'

const app = Fastify({ 
  logger: { 
    transport: { target: 'pino-pretty' } 
  },
  // ★ Aumentar límite del body a 50MB para imágenes base64
  bodyLimit: 50 * 1024 * 1024
})



// Middlewares
await app.register(helmet)
await app.register(cors, {
  origin: (origin, cb) => {
    // Permitir requests sin origin (Postman, curl, etc.)
    if (!origin) return cb(null, true)
    
    if (config.allowedOrigins.includes(origin)) {
      return cb(null, true)
    }
    cb(new Error('Origen no permitido'), false)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],  // ← AGREGAR Authorization
  credentials: true
})

// Rutas
await app.register(routes, { prefix: '' })

// Iniciar servidor
app.listen({ port: config.port, host: '0.0.0.0' }).then(addr => {
  app.log.info(`Servidor ejecutadose en ${addr}`)
  app.log.info(`Entorno: ${config.nodeEnv}`)
})