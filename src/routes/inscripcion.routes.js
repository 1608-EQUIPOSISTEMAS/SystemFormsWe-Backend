import { InscripcionController } from '../controllers/inscripcion.controller.js'

export default async function inscripcionRoutes(fastify) {
  fastify.post('/', InscripcionController.create)
}