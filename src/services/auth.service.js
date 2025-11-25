import { query, queryOne } from '../config/database.js'
import { hashPassword, comparePassword } from '../utils/password.js'
import { signToken } from '../utils/jwt.js'

export class AuthService {
  
  static async findByEmail(email) {
    return queryOne(
      `SELECT u.*, ur.code as role_code, ur.name as role_name
       FROM users u
       JOIN user_roles ur ON u.role_id = ur.id
       WHERE u.email = ? AND u.is_active = 1`,
      [email.toLowerCase().trim()]
    )
  }

  static async findById(id) {
    return queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone,
              u.email_verified_at, u.last_login_at, u.created_at,
              ur.code as role_code, ur.name as role_name
       FROM users u
       JOIN user_roles ur ON u.role_id = ur.id
       WHERE u.id = ? AND u.is_active = 1`,
      [id]
    )
  }

  static async validateCredentials(email, password) {
    const user = await this.findByEmail(email)
    
    if (!user) {
      return { valid: false, reason: 'USER_NOT_FOUND' }
    }

    const passwordValid = await comparePassword(password, user.password_hash)
    
    if (!passwordValid) {
      return { valid: false, reason: 'INVALID_PASSWORD' }
    }

    return { valid: true, user }
  }

  static async updateLastLogin(userId, ipAddress = null) {
    await query(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [userId]
    )

    // Log de auditoría opcional
    if (ipAddress) {
      await query(
        `INSERT INTO audit_log (table_name, record_id, action, new_values, ip_address)
         VALUES ('users', ?, 'LOGIN', '{}', ?)`,
        [userId, ipAddress]
      ).catch(() => {}) // No fallar si audit_log no existe
    }
  }

  static generateTokens(user) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role_code
    }

    const accessToken = signToken(payload)
    const refreshToken = signToken({ sub: user.id, type: 'refresh' }, '7d')

    return { accessToken, refreshToken }
  }

  static formatUserResponse(user) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone || null,
      emailVerified: !!user.email_verified_at,
      lastLogin: user.last_login_at,
      role: {
        code: user.role_code,
        name: user.role_name
      }
    }
  }

  static async createUser(data) {
    const passwordHash = await hashPassword(data.password)
    
    const result = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, role_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.email.toLowerCase().trim(),
        passwordHash,
        data.firstName,
        data.lastName,
        data.phone || null,
        data.roleId 
      ]
    )

    return result.insertId
  }

  static async changePassword(userId, currentPassword, newPassword) {
    const user = await queryOne(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    )

    if (!user) {
      return { success: false, reason: 'USER_NOT_FOUND' }
    }

    const valid = await comparePassword(currentPassword, user.password_hash)
    
    if (!valid) {
      return { success: false, reason: 'INVALID_CURRENT_PASSWORD' }
    }

    const newHash = await hashPassword(newPassword)
    
    await query(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [newHash, userId]
    )

    return { success: true }
  }
}