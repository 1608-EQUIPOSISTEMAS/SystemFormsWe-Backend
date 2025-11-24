import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { config } from './config/env.js'
import routes from './routes/index.js'

const app = Fastify({ 
  logger: { 
    transport: { target: 'pino-pretty' } 
  } 
})

// Middlewares
await app.register(helmet)
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || config.allowedOrigins.includes(origin)) {
      return cb(null, true)
    }
    cb(new Error('Origen no permitido'), false)
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
})

// Rutas
await app.register(routes, { prefix: '' })

// Iniciar servidor
app.listen({ port: config.port, host: '0.0.0.0' }).then(addr => {
  app.log.info(`Servidor ejecutadose en ${addr}`)
  app.log.info(`Entorno: ${config.nodeEnv}`)
})