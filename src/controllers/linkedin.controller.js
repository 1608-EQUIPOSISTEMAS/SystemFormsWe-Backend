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
      // 1. Intercambiar código por access_token
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          client_id: LINKEDIN_CLIENT_ID,
          client_secret: LINKEDIN_CLIENT_SECRET,
          redirect_uri: redirect_uri,
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

      // 2. Obtener información del usuario (incluyendo el 'sub' para el URN)
      const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
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
            id: userData.sub, // ★ Este es el ID para el URN
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
  // PUBLICAR POST EN LINKEDIN
  // ═══════════════════════════════════════
  static async createPost(req, reply) {
    const { access_token, user_id, text } = req.body

    if (!access_token || !user_id || !text) {
      return reply.code(400).send({ ok: false, error: 'Faltan parámetros requeridos' })
    }

    try {
      // ★ Crear el URN del usuario: urn:li:person:{sub}
      const authorUrn = `urn:li:person:${user_id}`

      // Crear el post usando UGC API
      const postBody = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: text
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      }

      console.log('LinkedIn Post Request:', JSON.stringify(postBody, null, 2))

      const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
      })

      // Verificar respuesta
      if (postResponse.status === 201) {
        const postId = postResponse.headers.get('X-RestLi-Id')
        return reply.send({
          ok: true,
          data: {
            postId: postId,
            message: 'Publicado exitosamente en LinkedIn'
          }
        })
      }

      // Error
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
}