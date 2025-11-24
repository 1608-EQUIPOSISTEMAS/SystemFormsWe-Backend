import { InscripcionService } from '../services/inscripcion.service.js'

export class InscripcionController {
  static async create(req, reply) {
    try {
      const body = req.body || {}
      const archivos = body.archivos || {}

      const result = await InscripcionService.create(body, archivos)
      return reply.send(result)
    } catch (error) {
      req.log.error({ 
        reqId: req.id, 
        message: error.message, 
        stack: error.stack 
      })
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al procesar la inscripción' 
      })
    }
  }
}