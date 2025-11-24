import { SheetsService } from './sheets.service.js'

export class InscripcionService {
  static async create(data, archivos) {
    await SheetsService.insertRow(data, archivos)
    return { ok: true, message: 'Inscripción registrada correctamente' }
  }
}