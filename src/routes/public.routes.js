// src/routes/public.routes.js
import { FormController } from '../controllers/form.controller.js'
import { ResponseController } from '../controllers/response.controller.js'

export default async function publicRoutes(fastify) {
  // Formulario público por UUID
  fastify.get('/forms/:uuid', FormController.getPublicForm)
  
  // Validar estudiante en Odoo
  fastify.post('/validate-student', ResponseController.validateStudent)
  
  // Enviar respuestas
  fastify.post('/responses/submit', ResponseController.submit)
  
  // Obtener resultado
  fastify.get('/responses/:response_uuid/result', ResponseController.getResult)

    fastify.get('/certificate/:responseUuid', ResponseController.getCertificatePdf)

}