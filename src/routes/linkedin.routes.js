import { LinkedInController } from '../controllers/linkedin.controller.js'

export default async function linkedinRoutes(fastify) {
  
  // Intercambiar código por token
  fastify.post('/exchange-token', LinkedInController.exchangeToken)
  
  // Publicar post (sin media)
  fastify.post('/post', LinkedInController.createPost)
  
  // Publicar post con imagen
  fastify.post('/post-with-image', LinkedInController.createPostWithImage)

  // Publicar post con múltiples imágenes
  fastify.post('/post-with-images', LinkedInController.createPostWithImages)

  // ★ NUEVO: Publicar con PDF como documento nativo de LinkedIn
  // Si falla el documento, hace fallback a imágenes
  fastify.post('/post-with-document', LinkedInController.createPostWithDocument)
}