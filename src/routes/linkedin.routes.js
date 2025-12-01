import { LinkedInController } from '../controllers/linkedin.controller.js'

export default async function linkedinRoutes(fastify) {
  
  // Intercambiar código por token
  fastify.post('/exchange-token', LinkedInController.exchangeToken)
  
  // Publicar post
  fastify.post('/post', LinkedInController.createPost)
}