import { getSheetsClient } from '../config/sheets.js'
import { config } from '../config/env.js'
import { safe, createHyperlink } from '../utils/helpers.js'

export class SheetsService {
  static async getNextRow() {
    const sheets = await getSheetsClient()
    const { spreadsheetId, sheetName } = config.sheets

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`
    })

    const rows = res.data.values?.length || 0
    return Math.max(2, rows + 1)
  }

  static async insertRow(data, archivos) {
    const sheets = await getSheetsClient()
    const { spreadsheetId, sheetName } = config.sheets
    const nextRow = await this.getNextRow()
    
    const frontKey = safe(archivos.dni_front_key)
    const backKey = safe(archivos.dni_back_key)
    
    const frontHref = frontKey 
      ? `${config.publicBaseUrl}/file/view?key=${encodeURIComponent(frontKey)}` 
      : ''
    const backHref = backKey 
      ? `${config.publicBaseUrl}/file/view?key=${encodeURIComponent(backKey)}` 
      : ''

    const row = [
      safe(data.email),
      safe(data.documento),
      safe(data.born),
      safe(data.apellidos),
      safe(data.nombres),
      safe(data.celular),
      safe(data.categoriaPrograma),
      safe(data.programa),
      safe(data.carrera),
      safe(data.carreraOtra),
      safe(data.universidad),
      safe(data.universidadOtra),
      safe(data.gradoAcademico),
      safe(data.situacionActual),
      safe(data.areaActual),
      safe(data.areaActualOtra),
      safe(data.areaDeseada),
      safe(data.areaDeseadaOtra),
      safe(data.empresa),
      safe(data.puesto),
      safe(data.aniosExp),
      safe(data.sector),
      safe(data.programaEmprendimiento),
      safe(data.tallerSpeaking),
      safe(data.pais),
      safe(data.departamento),
      safe(data.necesidadEspecial),
      safe(data.necesidadEspecialOtra),
      createHyperlink(frontHref, 'Ver DNI frontal'),
      createHyperlink(backHref, 'Ver DNI reverso'),
      frontKey,
      backKey,
      new Date().toISOString()
    ]

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${nextRow}:AG${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        majorDimension: 'ROWS',
        values: [row]
      }
    })
  }
}