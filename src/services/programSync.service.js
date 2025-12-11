// src/services/programSync.service.js
import { pgPool } from '../config/postgres.js'
import { pool as mysqlPool } from '../config/database.js'

export class ProgramSyncService {
  
  // Obtener programas desde PostgreSQL (W|E)
  static async fetchProgramsFromWE() {
    const client = await pgPool.connect()
    try {
      const result = await client.query(`
        SELECT program_id, program_name 
        FROM programs 
        WHERE cat_model_modality = 2623 
          AND cat_type_program = 2503
        ORDER BY program_name
      `)
      return result.rows
    } finally {
      client.release()
    }
  }

  // Sincronizar programas a tabla courses en MySQL
  static async syncToMysql() {
    const connection = await mysqlPool.getConnection()
    
    try {
      const programs = await this.fetchProgramsFromWE()
      console.log(`📥 ${programs.length} programas en W|E`)
      
      if (programs.length === 0) {
        return { synced: 0, skipped: 0, message: 'Sin programas' }
      }

      // Obtener codes existentes
      const [existing] = await connection.query(
        'SELECT code FROM courses WHERE code LIKE "WE-%"'
      )
      const existingCodes = new Set(existing.map(c => c.code))

      // Filtrar nuevos
      const newPrograms = programs.filter(p => !existingCodes.has(`WE-${p.program_id}`))
      
      if (newPrograms.length === 0) {
        return { synced: 0, skipped: programs.length, message: 'Ya sincronizado' }
      }

      // Insertar nuevos
      await connection.beginTransaction()
      
      for (const program of newPrograms) {
        await connection.query(
          'INSERT INTO courses (code, name, is_active) VALUES (?, ?, 1)',
          [`WE-${program.program_id}`, program.program_name]
        )
      }
      
      await connection.commit()
      
      console.log(`✅ ${newPrograms.length} programas sincronizados`)
      return { 
        synced: newPrograms.length, 
        skipped: programs.length - newPrograms.length,
        message: `${newPrograms.length} nuevos` 
      }
      
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  // Sync completo (desactiva eliminados)
  static async fullSync() {
    const connection = await mysqlPool.getConnection()
    
    try {
      const programs = await this.fetchProgramsFromWE()
      const validCodes = new Set(programs.map(p => `WE-${p.program_id}`))
      
      await connection.beginTransaction()
      
      // Desactivar los que ya no existen
      const [toDeactivate] = await connection.query(
        'SELECT id, code FROM courses WHERE code LIKE "WE-%" AND is_active = 1'
      )
      
      let deactivated = 0
      for (const course of toDeactivate) {
        if (!validCodes.has(course.code)) {
          await connection.query(
            'UPDATE courses SET is_active = 0 WHERE id = ?',
            [course.id]
          )
          deactivated++
        }
      }
      
      await connection.commit()
      
      const syncResult = await this.syncToMysql()
      
      return {
        ...syncResult,
        deactivated,
        message: `${syncResult.synced} nuevos, ${deactivated} desactivados`
      }
      
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
}