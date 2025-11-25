import { verifyToken } from '../utils/jwt.js'
import { queryOne } from '../config/database.js'
import { error } from '../utils/response.js'

export async function authenticate(req, reply) {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send(error('Token no proporcionado', 'UNAUTHORIZED'))
  }

  const token = authHeader.slice(7)
  const payload = verifyToken(token)

  if (!payload) {
    return reply.code(401).send(error('Token inválido', 'INVALID_TOKEN'))
  }

  if (payload.expired) {
    return reply.code(401).send(error('Token expirado', 'TOKEN_EXPIRED'))
  }

  // Verificar que el usuario aún existe y está activo
  const user = await queryOne(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active,
            ur.code as role_code, ur.name as role_name
     FROM users u
     JOIN user_roles ur ON u.role_id = ur.id
     WHERE u.id = ?`,
    [payload.sub]
  )

  if (!user || !user.is_active) {
    return reply.code(401).send(error('Usuario no válido', 'INVALID_USER'))
  }

  // Adjuntar usuario al request
  req.user = {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: {
      code: user.role_code,
      name: user.role_name
    }
  }
}

// Middleware para verificar roles específicos
export function requireRole(...roles) {
  return async (req, reply) => {
    await authenticate(req, reply)
    
    if (reply.sent) return // Si authenticate ya respondió con error
    
    if (!roles.includes(req.user.role.code)) {
      return reply.code(403).send(
        error('No tienes permisos para esta acción', 'FORBIDDEN')
      )
    }
  }
}

// Roles disponibles
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  INSTRUCTOR: 'INSTRUCTOR',
  USER: 'USER'
}