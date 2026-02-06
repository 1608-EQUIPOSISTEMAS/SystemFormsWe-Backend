// src/controllers/linkedin.controller.js
import { odooService } from '../services/odoo.service.js'

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || ''
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || ''
const LINKEDIN_VERSION = '202601'

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

  // ═══════════════════════════════════════════════════════════════
  // PUBLICAR CON IMÁGENES (existente - ugcPosts legacy)
  // ═══════════════════════════════════════════════════════════════
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
      const errBody = await response.text()
      console.error('❌ createPost error:', response.status, errBody)
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
          specificContent: { 
            'com.linkedin.ugc.ShareContent': { 
              shareCommentary: { text }, 
              shareMediaCategory: assets.length ? 'IMAGE' : 'NONE', 
              ...(assets.length && { media: assets.map(a => ({ status: 'READY', media: a })) }) 
            } 
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        }),
      })

      if (response.status === 201) return reply.send({ ok: true, data: { postId: response.headers.get('X-RestLi-Id'), imagesCount: assets.length } })
      return reply.code(400).send({ ok: false, error: 'Error al publicar' })
    } catch (error) {
      return reply.code(500).send({ ok: false, error: 'Error al publicar' })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ★★★ NUEVO: PUBLICAR CON PDF COMO DOCUMENTO ★★★
  // Usa la API nueva /rest/posts + /rest/documents
  // ═══════════════════════════════════════════════════════════════
  static async createPostWithDocument(req, reply) {
    const { access_token, user_id, text, images, certificate_id, pdf_base64: rawPdfBase64 } = req.body
    if (!access_token || !user_id || !text) {
      return reply.code(400).send({ ok: false, error: 'Faltan campos requeridos' })
    }

    try {
      let pdfBuffer = null
      let documentTitle = 'Certificado.pdf'

      // ── 1. Obtener el PDF ──────────────────────────────────
      if (certificate_id) {
        console.log('📄 Obteniendo PDF de Odoo, certificate_id:', certificate_id)
        const pdfBase64 = await odooService.getCertificatePdfBase64(certificate_id)
        if (pdfBase64) {
          pdfBuffer = Buffer.from(pdfBase64, 'base64')
          documentTitle = `Certificado_${certificate_id}.pdf`
          console.log('✅ PDF obtenido de Odoo, tamaño:', pdfBuffer.length, 'bytes')
        } else {
          console.warn('⚠️ No se pudo obtener PDF de Odoo, continuando sin documento')
        }
      } else if (rawPdfBase64) {
        pdfBuffer = Buffer.from(rawPdfBase64, 'base64')
        console.log('✅ PDF recibido directamente, tamaño:', pdfBuffer.length, 'bytes')
      }

      // ── 2. Si hay PDF → subir como documento y publicar con /rest/posts ──
      if (pdfBuffer) {
        const documentUrn = await LinkedInController.uploadDocumentToLinkedIn(access_token, user_id, pdfBuffer)

        if (documentUrn) {
          console.log('📤 Publicando post con documento:', documentUrn)
          
          const postResponse = await fetch('https://api.linkedin.com/rest/posts', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${access_token}`,
              'Content-Type': 'application/json',
              'X-Restli-Protocol-Version': '2.0.0',
              'LinkedIn-Version': LINKEDIN_VERSION,
            },
            body: JSON.stringify({
              author: `urn:li:person:${user_id}`,
              commentary: text,
              visibility: 'PUBLIC',
              distribution: {
                feedDistribution: 'MAIN_FEED',
                targetEntities: [],
                thirdPartyDistributionChannels: []
              },
              content: {
                media: {
                  title: documentTitle,
                  id: documentUrn
                }
              },
              lifecycleState: 'PUBLISHED',
              isReshareDisabledByAuthor: false
            }),
          })

          if (postResponse.status === 201) {
            const postId = postResponse.headers.get('x-restli-id')
            console.log('✅ Post con documento publicado:', postId)
            return reply.send({ ok: true, data: { postId, type: 'document', documentUrn } })
          }

          const errBody = await postResponse.text()
          console.error('❌ Error publicando con documento:', postResponse.status, errBody)
          
          // Si falla el documento, intentar con imágenes como fallback
          console.log('🔄 Fallback: publicando solo con imágenes...')
        } else {
          console.warn('⚠️ No se pudo subir documento, fallback a imágenes')
        }
      }

      // ── 3. Fallback: publicar con imágenes (si hay) ──────
      const assets = []
      if (images?.length) {
        console.log(`📤 Fallback: subiendo ${images.length} imágenes...`)
        for (let i = 0; i < images.length; i++) {
          const asset = await LinkedInController.uploadImageToLinkedIn(access_token, user_id, images[i])
          if (asset) { assets.push(asset); console.log(`✅ Imagen ${i + 1} subida`) }
        }
      }

      console.log('📤 Publicando con', assets.length, 'imágenes (fallback)')
      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
        body: JSON.stringify({
          author: `urn:li:person:${user_id}`,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
              shareMediaCategory: assets.length ? 'IMAGE' : 'NONE',
              ...(assets.length && { media: assets.map(a => ({ status: 'READY', media: a })) })
            }
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
        }),
      })

      if (response.status === 201) {
        return reply.send({ ok: true, data: { postId: response.headers.get('X-RestLi-Id'), type: 'images', imagesCount: assets.length } })
      }

      const errText = await response.text()
      console.error('❌ Error fallback imágenes:', response.status, errText)
      return reply.code(400).send({ ok: false, error: 'Error al publicar' })

    } catch (error) {
      console.error('❌ Error general createPostWithDocument:', error)
      return reply.code(500).send({ ok: false, error: error.message || 'Error al publicar' })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ★ UPLOAD: Documento PDF a LinkedIn (Documents API)
  // ═══════════════════════════════════════════════════════════════
  static async uploadDocumentToLinkedIn(token, userId, pdfBuffer) {
    try {
      // Paso 1: Inicializar upload
      console.log('📤 [Documents API] Inicializando upload...')
      const initResponse = await fetch('https://api.linkedin.com/rest/documents?action=initializeUpload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': LINKEDIN_VERSION,
        },
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: `urn:li:person:${userId}`
          }
        }),
      })

      const initData = await initResponse.json()

      if (!initData.value) {
        console.error('❌ [Documents API] Error al inicializar:', JSON.stringify(initData))
        return null
      }

      const uploadUrl = initData.value.uploadUrl
      const documentUrn = initData.value.document
      console.log('✅ [Documents API] Upload URL obtenida, URN:', documentUrn)

      // Paso 2: Subir el PDF binario
      console.log('📤 [Documents API] Subiendo PDF...', pdfBuffer.length, 'bytes')
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/pdf',
        },
        body: pdfBuffer,
      })

      if (uploadResponse.status === 200 || uploadResponse.status === 201) {
        console.log('✅ [Documents API] PDF subido exitosamente')
        return documentUrn
      }

      const uploadErr = await uploadResponse.text()
      console.error('❌ [Documents API] Error al subir PDF:', uploadResponse.status, uploadErr)
      return null

    } catch (error) {
      console.error('❌ [Documents API] Error:', error.message)
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD: Imagen a LinkedIn (legacy assets API)
  // ═══════════════════════════════════════════════════════════════
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
      console.error('Upload image error:', e)
      return null
    }
  }
}