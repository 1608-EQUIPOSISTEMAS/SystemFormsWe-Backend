import jwt from 'jsonwebtoken'
import { config } from '../config/env.js'

export function signToken(payload, expiresIn = config.jwt.expiresIn) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret)
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { expired: true }
    }
    return null
  }
}

export function decodeToken(token) {
  return jwt.decode(token)
}