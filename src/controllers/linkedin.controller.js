const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || ''
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || ''

export class LinkedInController {

  // ═══════════════════════════════════════
  // INTERCAMBIAR CÓDIGO POR TOKEN
  // ═══════════════════════════════════════
  static async exchangeToken(req, reply) {
    const { code, redirect_uri } = req.body

    if (!code) {
      return reply.code(400).send({ ok: false, error: 'Código requerido' })
    }

    try {
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: LINKEDIN_CLIENT_ID,
          client_secret: LINKEDIN_CLIENT_SECRET,
          redirect_uri,
        }),
      })

      const tokenData = await tokenResponse.json()

      if (tokenData.error) {
        console.error('LinkedIn Token Error:', tokenData)
        return reply.code(400).send({ 
          ok: false, 
          error: tokenData.error_description || 'Error al obtener token' 
        })
      }

      const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
      })

      const userData = await userResponse.json()

      if (!userData.sub) {
        console.error('LinkedIn UserInfo Error:', userData)
        return reply.code(400).send({ 
          ok: false, 
          error: 'No se pudo obtener información del usuario' 
        })
      }

      return reply.send({
        ok: true,
        data: {
          access_token: tokenData.access_token,
          expires_in: tokenData.expires_in,
          user: {
            id: userData.sub,
            name: userData.name,
            email: userData.email,
            picture: userData.picture
          }
        }
      })

    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al procesar autorización' })
    }
  }

  // ═══════════════════════════════════════
  // PUBLICAR POST SIMPLE (sin imagen)
  // ═══════════════════════════════════════
  static async createPost(req, reply) {
    const { access_token, user_id, text } = req.body

    if (!access_token || !user_id || !text) {
      return reply.code(400).send({ ok: false, error: 'Faltan parámetros requeridos' })
    }

    try {
      const authorUrn = `urn:li:person:${user_id}`

      const postBody = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      }

      const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
      })

      if (postResponse.status === 201) {
        const postId = postResponse.headers.get('X-RestLi-Id')
        return reply.send({
          ok: true,
          data: { postId, message: 'Publicado exitosamente en LinkedIn' }
        })
      }

      const errorData = await postResponse.json().catch(() => ({}))
      console.error('LinkedIn Post Error:', postResponse.status, errorData)
      
      return reply.code(400).send({ 
        ok: false, 
        error: errorData.message || `Error al publicar (${postResponse.status})` 
      })

    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al publicar en LinkedIn' })
    }
  }

  // ═══════════════════════════════════════
  // PUBLICAR POST CON UNA IMAGEN
  // ═══════════════════════════════════════
  static async createPostWithImage(req, reply) {
    const { access_token, user_id, text, image_base64 } = req.body

    if (!access_token || !user_id || !text) {
      return reply.code(400).send({ ok: false, error: 'Faltan parámetros requeridos' })
    }

    try {
      const authorUrn = `urn:li:person:${user_id}`
      let imageAsset = null

      if (image_base64) {
        imageAsset = await LinkedInController.uploadImage(access_token, user_id, image_base64)
        if (!imageAsset) {
          console.log('⚠️ No se pudo subir imagen, publicando solo texto')
        }
      }

      const postBody = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: imageAsset ? 'IMAGE' : 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      }

      if (imageAsset) {
        postBody.specificContent['com.linkedin.ugc.ShareContent'].media = [{
          status: 'READY',
          media: imageAsset
        }]
      }

      const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
      })

      if (postResponse.status === 201) {
        const postId = postResponse.headers.get('X-RestLi-Id')
        return reply.send({
          ok: true,
          data: { 
            postId, 
            message: imageAsset ? 'Publicado con imagen' : 'Publicado sin imagen',
            hasImage: !!imageAsset
          }
        })
      }

      const errorData = await postResponse.json().catch(() => ({}))
      console.error('LinkedIn Post Error:', postResponse.status, errorData)
      
      return reply.code(400).send({ 
        ok: false, 
        error: errorData.message || `Error al publicar (${postResponse.status})` 
      })

    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al publicar en LinkedIn' })
    }
  }

  // ═══════════════════════════════════════
  // PUBLICAR POST CON MÚLTIPLES IMÁGENES
  // ═══════════════════════════════════════
  static async createPostWithImages(req, reply) {
    const { access_token, user_id, text, images } = req.body

    if (!access_token || !user_id || !text) {
      return reply.code(400).send({ ok: false, error: 'Faltan parámetros requeridos' })
    }

    try {
      const authorUrn = `urn:li:person:${user_id}`
      const uploadedAssets = []

      // Subir cada imagen
      if (images && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          console.log(`📤 Subiendo imagen ${i + 1} de ${images.length}...`)
          const asset = await LinkedInController.uploadImage(access_token, user_id, images[i])
          if (asset) {
            uploadedAssets.push(asset)
            console.log(`✅ Imagen ${i + 1} subida exitosamente`)
          } else {
            console.log(`⚠️ Imagen ${i + 1} no se pudo subir`)
          }
        }
      }

      const postBody = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: uploadedAssets.length > 0 ? 'IMAGE' : 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      }

      if (uploadedAssets.length > 0) {
        postBody.specificContent['com.linkedin.ugc.ShareContent'].media = uploadedAssets.map(asset => ({
          status: 'READY',
          media: asset
        }))
      }

      console.log('📤 LinkedIn Post con', uploadedAssets.length, 'imágenes')

      const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
      })

      if (postResponse.status === 201) {
        const postId = postResponse.headers.get('X-RestLi-Id')
        return reply.send({
          ok: true,
          data: { 
            postId, 
            message: `Publicado con ${uploadedAssets.length} imagen(es)`,
            imagesCount: uploadedAssets.length
          }
        })
      }

      const errorData = await postResponse.json().catch(() => ({}))
      console.error('LinkedIn Post Error:', postResponse.status, errorData)
      
      return reply.code(400).send({ 
        ok: false, 
        error: errorData.message || `Error al publicar (${postResponse.status})` 
      })

    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({ ok: false, error: 'Error al publicar en LinkedIn' })
    }
  }

  // ═══════════════════════════════════════
  // CONVERTIR PDF A IMAGEN
  // ═══════════════════════════════════════
  static async pdfToImage(req, reply) {
    const { pdf_url } = req.body

    if (!pdf_url) {
      return reply.code(400).send({ ok: false, error: 'URL del PDF requerida' })
    }

    try {
      console.log('📄 Descargando PDF:', pdf_url)
      
      // Descargar el PDF
      const response = await fetch(pdf_url)
      
      if (!response.ok) {
        console.error('Error descargando PDF:', response.status, response.statusText)
        return reply.code(400).send({ ok: false, error: 'No se pudo descargar el PDF' })
      }
      
      const pdfBuffer = await response.arrayBuffer()
      console.log('📄 PDF descargado, tamaño:', pdfBuffer.byteLength, 'bytes')
      
      // Importar pdf.js dinámicamente
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      
      // Cargar el PDF
      const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise
      console.log('📄 PDF cargado, páginas:', pdf.numPages)
      
      // Obtener la primera página
      const page = await pdf.getPage(1)
      
      // Escala para buena calidad
      const scale = 2
      const viewport = page.getViewport({ scale })
      
      // Importar canvas
      const { createCanvas } = await import('canvas')
      const canvas = createCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')
      
      // Fondo blanco
      context.fillStyle = 'white'
      context.fillRect(0, 0, viewport.width, viewport.height)
      
      // Renderizar la página
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise
      
      // Convertir a base64
      const imageBase64 = canvas.toDataURL('image/png').split(',')[1]
      
      console.log('✅ PDF convertido a imagen exitosamente')
      
      return reply.send({
        ok: true,
        data: {
          image_base64: imageBase64,
          width: viewport.width,
          height: viewport.height
        }
      })
      
    } catch (error) {
      console.error('Error convirtiendo PDF:', error)
      return reply.code(500).send({ 
        ok: false, 
        error: 'Error al convertir PDF: ' + error.message 
      })
    }
  }

  // ═══════════════════════════════════════
  // HELPER: Subir imagen a LinkedIn
  // ═══════════════════════════════════════
  static async uploadImage(accessToken, userId, imageBase64) {
    try {
      // PASO 1: Registrar upload
      const registerBody = {
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: `urn:li:person:${userId}`,
          serviceRelationships: [{
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }]
        }
      }

      console.log('📸 Registrando upload de imagen...')

      const registerResponse = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(registerBody)
      })

      if (!registerResponse.ok) {
        const errorText = await registerResponse.text()
        console.error('❌ Error al registrar upload:', errorText)
        return null
      }

      const registerData = await registerResponse.json()
      const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl
      const asset = registerData.value.asset

      // PASO 2: Convertir base64 a buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64')
      console.log('📤 Subiendo imagen...', imageBuffer.length, 'bytes')

      // PASO 3: Subir imagen
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'image/png'
        },
        body: imageBuffer
      })

      if (!uploadResponse.ok) {
        console.error('❌ Error al subir imagen:', uploadResponse.status)
        return null
      }

      console.log('✅ Imagen subida exitosamente')
      return asset

    } catch (error) {
      console.error('❌ Error en uploadImage:', error)
      return null
    }
  }
}