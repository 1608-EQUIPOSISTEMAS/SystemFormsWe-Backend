import { StorageService } from '../services/storage.service.js'

export class UploadController {
  static async generateSignedUrl(req, reply) {
    const { contentType, side } = req.body || {}

    if (!contentType || !side) {
      return reply.code(400).send({ 
        error: 'contentType y side son requeridos' 
      })
    }

    try {
      const result = await StorageService.generateUploadUrl(contentType, side)
      return reply.send(result)
    } catch (error) {
      req.log.error(error)
      return reply.code(400).send({ error: error.message })
    }
  }

  static async viewFile(req, reply) {
    const { key } = req.query || {}

    if (!key) {
      return reply.code(400).send({ error: 'key es requerido' })
    }

    try {
      const signedUrl = await StorageService.generateViewUrl(String(key))
      return reply.redirect(signedUrl)
    } catch (error) {
      req.log.error(error)
      return reply.code(404).send({ error: 'Archivo no encontrado' })
    }
  }
}