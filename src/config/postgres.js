import pg from 'pg'

const { Pool } = pg

// Conexión a base de datos principal W|E (Neon PostgreSQL)
const pgPool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_q0DjXULPzs2v@ep-floral-cell-aho11jh8-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
})

// Test connection
pgPool.connect()
  .then(client => {
    console.log('✅ PostgreSQL (W|E) conectado')
    client.release()
  })
  .catch(err => {
    console.error('❌ Error PostgreSQL:', err.message)
  })

export { pgPool }