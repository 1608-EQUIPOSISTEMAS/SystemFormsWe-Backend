// src/controllers/linkedin.controller.js
import { odooService } from '../services/odoo.service.js'

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || ''
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || ''

export class LinkedInController {

  static async exchangeToken(req, reply) {
    const { code, redirect_uri } = req.body
    if (!code) return reply.code(400).send({ ok: false, error: 'Código requerido' })

    try {
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code,
          client_id: LINKEDIN_CLIENT_ID,
          client_secret: LINKEDIN_CLIENT_SECRET,
          redirect_uri,
        }),
      })
      const tokenData = await tokenResponse.json()
      if (tokenData.error) return reply.code(400).send({ ok: false, error: tokenData.error_description })

      const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
      })
      const userData = await userResponse.json()
      if (!userData.sub) return reply.code(400).send({ ok: false, error: 'No se pudo obtener usuario' })

      return reply.send({
        ok: true,
        data: {
          access_token: tokenData.access_token,
          user: { id: userData.sub, name: userData.name, email: userData.email }
        }
      })
    } catch (error) {
      return reply.code(500).send({ ok: false, error: 'Error al intercambiar token' })
    }
  }

  static async createPost(req, reply) {
    const { access_token, user_id, text } = req.body
    if (!access_token || !user_id || !text) return reply.code(400).send({ ok: false, error: 'Faltan campos' })

    try {
      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: `urn:li:person:${user_id}`,
          lifecycleState: 'PUBLISHED',
          specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        }),
      })
      if (response.status === 201) return reply.send({ ok: true, data: { postId: response.headers.get('X-RestLi-Id') } })
      return reply.code(400).send({ ok: false, error: 'Error al publicar' })
    } catch (error) {
      return reply.code(500).send({ ok: false, error: 'Error al publicar' })
    }
  }

  static async createPostWithImage(req, reply) {
    const { access_token, user_id, text, image_base64 } = req.body
    if (!access_token || !user_id || !text) return reply.code(400).send({ ok: false, error: 'Faltan campos' })

    try {
      let asset = image_base64 ? await LinkedInController.uploadImageToLinkedIn(access_token, user_id, image_base64) : null
      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
        body: JSON.stringify({
          author: `urn:li:person:${user_id}`,
          lifecycleState: 'PUBLISHED',
          specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: asset ? 'IMAGE' : 'NONE', ...(asset && { media: [{ status: 'READY', media: asset }] }) } },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        }),
      })
      if (response.status === 201) return reply.send({ ok: true, data: { postId: response.headers.get('X-RestLi-Id') } })
      return reply.code(400).send({ ok: false, error: 'Error al publicar' })
    } catch (error) {
      return reply.code(500).send({ ok: false, error: 'Error al publicar' })
    }
  }

  static async createPostWithImages(req, reply) {
    const { access_token, user_id, text, images } = req.body
    if (!access_token || !user_id || !text) return reply.code(400).send({ ok: false, error: 'Faltan campos' })

    try {
      const assets = []
      if (images?.length) {
        console.log(`📤 Subiendo ${images.length} imágenes...`)
        for (let i = 0; i < images.length; i++) {
          const asset = await LinkedInController.uploadImageToLinkedIn(access_token, user_id, images[i])
          if (asset) { assets.push(asset); console.log(`✅ Imagen ${i + 1} subida`) }
        }
      }

      console.log('📤 Publicando con', assets.length, 'imágenes')
      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
        body: JSON.stringify({
          author: `urn:li:person:${user_id}`,
          lifecycleState: 'PUBLISHED',
          specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: assets.length ? 'IMAGE' : 'NONE', ...(assets.length && { media: assets.map(a => ({ status: 'READY', media: a })) }) } },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        }),
      })

      if (response.status === 201) return reply.send({ ok: true, data: { postId: response.headers.get('X-RestLi-Id'), imagesCount: assets.length } })
      return reply.code(400).send({ ok: false, error: 'Error al publicar' })
    } catch (error) {
      return reply.code(500).send({ ok: false, error: 'Error al publicar' })
    }
  }

  // ═══════════════════════════════════════
  // ★★★ PDF A IMAGEN - pdf-to-png-converter ★★★
  // ═══════════════════════════════════════
  static async pdfToImage(req, reply) {
    const { pdf_url, certificate_id } = req.body
    if (!pdf_url && !certificate_id) {
      return reply.code(400).send({ ok: false, error: 'Falta pdf_url o certificate_id' })
    }

    try {
      let pdfBuffer

      if (certificate_id) {
        console.log('📄 Obteniendo PDF de Odoo ID:', certificate_id)
        const pdfBase64 = await odooService.getCertificatePdfBase64(certificate_id)
        if (!pdfBase64) {
          return reply.code(400).send({ ok: false, error: 'No se pudo obtener PDF de Odoo' })
        }
        pdfBuffer = Buffer.from(pdfBase64, 'base64')
        console.log('📄 PDF obtenido, tamaño:', pdfBuffer.length)
      } else {
        console.log('📄 Descargando PDF:', pdf_url)
        const res = await fetch(pdf_url)
        if (!res.ok) {
          return reply.code(400).send({ ok: false, error: 'No se pudo descargar PDF' })
        }
        pdfBuffer = Buffer.from(await res.arrayBuffer())
      }

      // ★ Convertir PDF a PNG
      console.log('🎨 Convirtiendo PDF a imagen...')
      const { pdfToPng } = await import('pdf-to-png-converter')
      
      const pngPages = await pdfToPng(pdfBuffer, {
        viewportScale: 2.0,
        disableFontFace: false,
        useSystemFonts: true,
        pagesToProcess: [1]
      })

      if (!pngPages || pngPages.length === 0) {
        throw new Error('No se pudo convertir el PDF')
      }

      const imageBuffer = pngPages[0].content
      const imageBase64 = imageBuffer.toString('base64')

      console.log('✅ PDF convertido, tamaño imagen:', imageBuffer.length)

      return reply.send({
        ok: true,
        data: {
          image_base64: imageBase64,
          width: pngPages[0].width,
          height: pngPages[0].height
        }
      })

    } catch (error) {
      console.error('❌ Error PDF:', error.message)
      return reply.code(500).send({ ok: false, error: error.message })
    }
  }

  static async uploadImageToLinkedIn(token, userId, base64) {
    try {
      const reg = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: `urn:li:person:${userId}`,
            serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }]
          }
        }),
      })
      const data = await reg.json()
      if (!data.value) return null

      const url = data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl
      const asset = data.value.asset

      const up = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: Buffer.from(base64, 'base64'),
      })

      return (up.status === 200 || up.status === 201) ? asset : null
    } catch (e) {
      console.error('Upload error:', e)
      return null
    }
  }
}