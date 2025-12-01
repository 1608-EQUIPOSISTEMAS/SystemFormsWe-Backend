import 'dotenv/config'

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
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
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Inscripciones',
  },

  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  odoo: {
    url: process.env.ODOO_URL || '',
    db: process.env.ODOO_DB || '',
    login: process.env.ODOO_LOGIN,
    password: process.env.ODOO_PASSWORD,
  },
  
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000',
}

// Validación de variables críticas
const requiredEnvVars = [
  ['db.host', config.db.host],
  ['db.name', config.db.name],
  ['jwt.secret', config.jwt.secret]
]

if (config.isProduction) {
  requiredEnvVars.push(
    ['gcp.projectId', config.gcp.projectId],
    ['gcp.credentialsPath', config.gcp.credentialsPath],
    ['gcp.bucket', config.gcp.bucket],
    ['odoo.login', config.odoo.login],
    ['odoo.password', config.odoo.password]
  )
}

for (const [name, value] of requiredEnvVars) {
  if (!value) {
    console.warn(`Variable de entorno faltante: ${name}`)
  }
}

// JWT validacion de caracteres
if (config.isProduction && config.jwt.secret && config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción')
}