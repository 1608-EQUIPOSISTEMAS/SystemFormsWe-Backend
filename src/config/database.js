import mysql from 'mysql2/promise'
import { config } from './env.js'

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  waitForConnections: true,
  connectionLimit: 30,          // Subido de 20 a 30
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // Ping cada 10s para mantener vivas
  connectTimeout: 10000,        // 10s timeout para conectar
  maxIdle: 10,                  // Máx conexiones idle
  idleTimeout: 60000,           // Cerrar idle después de 60s
})

// Manejo de errores del pool
pool.on('connection', (connection) => {
  console.log('🔗 Nueva conexión MySQL creada')
})

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ Base de datos conectada exitosamente')
    conn.release()
  })
  .catch(err => {
    console.error('❌ Falló la conexión a la base de datos:', err.message)
    process.exit(1)
  })

// Helper: query con retry automático
export async function queryWithRetry(sql, params = [], retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const [rows] = await pool.execute(sql, params)
      return rows
    } catch (error) {
      if (attempt < retries && (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ETIMEDOUT')) {
        console.warn(`⚠️ MySQL retry ${attempt + 1}/${retries}: ${error.code}`)
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
}

// Helper: getConnection con retry
export async function getConnectionWithRetry(retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const conn = await pool.getConnection()
      // Probar que la conexión está viva
      await conn.ping()
      return conn
    } catch (error) {
      if (attempt < retries && (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ETIMEDOUT')) {
        console.warn(`⚠️ MySQL connection retry ${attempt + 1}/${retries}: ${error.code}`)
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
}

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] || null
}

export async function transaction(callback) {
  const conn = await getConnectionWithRetry()
  await conn.beginTransaction()
  
  try {
    const result = await callback(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

export { pool }
export default pool