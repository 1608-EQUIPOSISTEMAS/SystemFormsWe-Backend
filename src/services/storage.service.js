import crypto from 'crypto'
import { bucket } from '../config/storage.js'
import { ALLOWED_MIME_TYPES, MIME_TO_EXT, UPLOAD_EXPIRATION, VIEW_EXPIRATION } from '../utils/constants.js'

export class StorageService {
  static async generateUploadUrl(contentType, side) {
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error('Tipo de archivo no permitido')
    }

    if (!['front', 'back'].includes(side)) {
      throw new Error('Side debe ser "front" o "back"')
    }

    const ext = MIME_TO_EXT[contentType] || 'bin'
    const key = `dni/${side}/${crypto.randomBytes(8).toString('hex')}.${ext}`

    const [uploadUrl] = await bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + UPLOAD_EXPIRATION,
      contentType,
      extensionHeaders: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-goog-meta-side': side
      }
    })

    return { uploadUrl, key }
  }

  static async generateViewUrl(key) {
    const [signedUrl] = await bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + VIEW_EXPIRATION
    })

    return signedUrl
  }
}