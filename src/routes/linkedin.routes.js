import { LinkedInController } from '../controllers/linkedin.controller.js'

export default async function linkedinRoutes(fastify) {
  
  // Intercambiar código por token
  fastify.post('/exchange-token', LinkedInController.exchangeToken)
  
  // Publicar post (sin imagen)
  fastify.post('/post', LinkedInController.createPost)
  
  // ★ NUEVO: Publicar post con imagen
  fastify.post('/post-with-image', LinkedInController.createPostWithImage)

  fastify.post('/post-with-images', LinkedInController.createPostWithImages)
  
  // ★ NUEVO: Convertir PDF a imagen
  fastify.post('/pdf-to-image', LinkedInController.pdfToImage)
}