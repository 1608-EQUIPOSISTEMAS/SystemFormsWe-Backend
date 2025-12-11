// src/controllers/sync.controller.js
import { ProgramSyncService } from '../services/programSync.service.js'
import { scheduler } from '../services/scheduler.service.js'

export class SyncController {
  
  // POST /sync/programs
  static async syncPrograms(req, reply) {
    try {
      const { full } = req.query
      
      const result = full === 'true' 
        ? await ProgramSyncService.fullSync()
        : await ProgramSyncService.syncToMysql()
      
      return reply.send({ ok: true, data: result })
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: 'Error en sincronización',
        details: error.message
      })
    }
  }

  // GET /sync/status
  static async getStatus(req, reply) {
    try {
      const programs = await ProgramSyncService.fetchProgramsFromWE()
      const schedulerStatus = scheduler.getStatus()
      
      return reply.send({
        ok: true,
        data: {
          programsInWE: programs.length,
          scheduler: schedulerStatus,
          lastCheck: new Date().toISOString()
        }
      })
    } catch (error) {
      req.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: 'Error verificando estado'
      })
    }
  }
}