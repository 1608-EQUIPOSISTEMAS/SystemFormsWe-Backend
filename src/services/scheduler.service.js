// src/services/scheduler.service.js
import { ProgramSyncService } from './programSync.service.js'

class SchedulerService {
  constructor() {
    this.intervals = new Map()
    this.lastRun = new Map()
  }

  // Iniciar sincronización automática
  startProgramSync(intervalMs = 60 * 60 * 1000) {
    if (this.intervals.has('programSync')) {
      this.stopProgramSync()
    }

    console.log(`🔄 Sync automático cada ${intervalMs / 1000 / 60} min`)

    // Ejecutar al iniciar
    this.runProgramSync()

    // Programar ejecuciones
    const id = setInterval(() => this.runProgramSync(), intervalMs)
    this.intervals.set('programSync', id)
  }

  async runProgramSync() {
    console.log(`⏰ [${new Date().toLocaleTimeString()}] Sincronizando...`)
    
    try {
      const result = await ProgramSyncService.syncToMysql()
      this.lastRun.set('programSync', {
        timestamp: new Date(),
        success: true,
        result
      })
      console.log(`✅ Sync OK:`, result.message)
    } catch (error) {
      this.lastRun.set('programSync', {
        timestamp: new Date(),
        success: false,
        error: error.message
      })
      console.error(`❌ Sync error:`, error.message)
    }
  }

  stopProgramSync() {
    const id = this.intervals.get('programSync')
    if (id) {
      clearInterval(id)
      this.intervals.delete('programSync')
    }
  }

  getStatus() {
    return {
      programSync: {
        active: this.intervals.has('programSync'),
        lastRun: this.lastRun.get('programSync') || null
      }
    }
  }

  stopAll() {
    for (const [, id] of this.intervals) {
      clearInterval(id)
    }
    this.intervals.clear()
  }
}

export const scheduler = new SchedulerService()