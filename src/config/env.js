import 'dotenv/config'

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  
  gcp: {
    projectId: process.env.GCP_PROJECT_ID,
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    bucket: process.env.GCS_BUCKET
  },
  
  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    sheetName: 'Inscripciones'
  },
  
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000'
}

// Validacion de las variables de entorno importantes
const required = [
  'gcp.projectId',
  'gcp.credentialsPath',
  'gcp.bucket',
  'sheets.spreadsheetId'
]

for (const key of required) {
  const value = key.split('.').reduce((obj, k) => obj?.[k], config)
  if (!value) {
    throw new Error(`Estas variables de entorno estan faltando: ${key}`)
  }
}