import mysql from 'mysql2/promise'
import { config } from './env.js'

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
})

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('Base de datos conectada exitosamente')
    conn.release()
  })
  .catch(err => {
    console.error('Falló la conexión a la base de datos:', err.message)
    process.exit(1)
  })

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] || null
}

export async function transaction(callback) {
  const conn = await pool.getConnection()
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
