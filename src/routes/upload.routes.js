import { UploadController } from '../controllers/upload.controller.js'

export default async function uploadRoutes(fastify) {
  fastify.post('/sign', UploadController.generateSignedUrl)
}