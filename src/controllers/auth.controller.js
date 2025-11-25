import { AuthService } from '../services/auth.service.js'
import { success, error } from '../utils/response.js'

export class AuthController {

  static async login(req, reply) {
    const { email, password } = req.body || {}

    // Validaciones
    if (!email?.trim()) {
      return reply.code(400).send(error('El correo es requerido', 'VALIDATION_ERROR'))
    }

    if (!password) {
      return reply.code(400).send(error('La contraseña es requerida', 'VALIDATION_ERROR'))
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send(error('Correo electrónico inválido', 'VALIDATION_ERROR'))
    }

    try {
      const result = await AuthService.validateCredentials(email, password)

      if (!result.valid) {
        // Respuesta genérica por seguridad
        return reply.code(401).send(error('Credenciales inválidas', 'INVALID_CREDENTIALS'))
      }

      const { user } = result
      const ipAddress = req.ip || req.headers['x-forwarded-for']
      
      await AuthService.updateLastLogin(user.id, ipAddress)
      
      const tokens = AuthService.generateTokens(user)
      const userData = AuthService.formatUserResponse(user)

      return reply.send(success({
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: userData
      }, 'Inicio de sesión exitoso'))

    } catch (err) {
      req.log.error({ err, email }, 'Error en login')
      return reply.code(500).send(error('Error interno del servidor', 'INTERNAL_ERROR'))
    }
  }

  static async me(req, reply) {
    try {
      // req.user ya viene del middleware authenticate
      const user = await AuthService.findById(req.user.id)

      if (!user) {
        return reply.code(404).send(error('Usuario no encontrado', 'USER_NOT_FOUND'))
      }

      return reply.send(success({
        user: AuthService.formatUserResponse(user)
      }))

    } catch (err) {
      req.log.error({ err }, 'Error en me')
      return reply.code(500).send(error('Error interno del servidor', 'INTERNAL_ERROR'))
    }
  }

  static async refresh(req, reply) {
    const { refreshToken } = req.body || {}

    if (!refreshToken) {
      return reply.code(400).send(error('Refresh token requerido', 'VALIDATION_ERROR'))
    }

    try {
      const { verifyToken } = await import('../utils/jwt.js')
      const payload = verifyToken(refreshToken)

      if (!payload || payload.type !== 'refresh') {
        return reply.code(401).send(error('Refresh token inválido', 'INVALID_TOKEN'))
      }

      if (payload.expired) {
        return reply.code(401).send(error('Refresh token expirado', 'TOKEN_EXPIRED'))
      }

      const user = await AuthService.findById(payload.sub)

      if (!user) {
        return reply.code(401).send(error('Usuario no válido', 'INVALID_USER'))
      }

      const tokens = AuthService.generateTokens(user)

      return reply.send(success({
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken
      }, 'Token renovado'))

    } catch (err) {
      req.log.error({ err }, 'Error en refresh')
      return reply.code(500).send(error('Error interno del servidor', 'INTERNAL_ERROR'))
    }
  }

  static async changePassword(req, reply) {
    const { currentPassword, newPassword } = req.body || {}

    if (!currentPassword || !newPassword) {
      return reply.code(400).send(
        error('Contraseña actual y nueva son requeridas', 'VALIDATION_ERROR')
      )
    }

    if (newPassword.length < 8) {
      return reply.code(400).send(
        error('La nueva contraseña debe tener al menos 8 caracteres', 'VALIDATION_ERROR')
      )
    }

    try {
      const result = await AuthService.changePassword(
        req.user.id,
        currentPassword,
        newPassword
      )

      if (!result.success) {
        if (result.reason === 'INVALID_CURRENT_PASSWORD') {
          return reply.code(400).send(error('Contraseña actual incorrecta', 'INVALID_PASSWORD'))
        }
        return reply.code(400).send(error('No se pudo cambiar la contraseña', 'ERROR'))
      }

      return reply.send(success(null, 'Contraseña actualizada correctamente'))

    } catch (err) {
      req.log.error({ err }, 'Error en changePassword')
      return reply.code(500).send(error('Error interno del servidor', 'INTERNAL_ERROR'))
    }
  }

  static async logout(req, reply) {
    // En JWT stateless, el logout es del lado del cliente
    // Aquí podrías invalidar el token en una blacklist si lo necesitas
    return reply.send(success(null, 'Sesión cerrada'))
  }
}