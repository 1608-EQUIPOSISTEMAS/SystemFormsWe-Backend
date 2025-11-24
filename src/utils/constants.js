export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic'
])

export const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic'
}

export const UPLOAD_EXPIRATION = 5 * 60 * 1000 // 5 minutos
export const VIEW_EXPIRATION = 10 * 60 * 1000  // 10 minutos