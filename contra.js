import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

async function fixPassword() {
  const password = 'Admin123!'
  const hash = await bcrypt.hash(password, 12)
  
  console.log('Password:', password)
  console.log('Nuevo hash:', hash)
  
  const connection = await mysql.createConnection({
    host: 'mainline.proxy.rlwy.net',
    port: 20070,
    database: 'railway',
    user: 'root',
    password: 'ZPfrZjhdbEPCYCGWlMgThXPZMRrfOeOe'
  })
  
  await connection.execute(
    'UPDATE users SET password_hash = ? WHERE email = ?',
    [hash, 'admin@we.edu.pe']
  )
  
  console.log('✅ Password actualizado!')
  await connection.end()
}

fixPassword()