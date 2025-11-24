import { UploadController } from '../controllers/upload.controller.js'

export default async function fileRoutes(fastify) {
  fastify.get('/view', UploadController.viewFile)
}