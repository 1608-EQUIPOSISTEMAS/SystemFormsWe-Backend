import { google } from 'googleapis'
import { config } from './env.js'

let sheetsClient = null

export async function getSheetsClient() {
  if (sheetsClient) return sheetsClient

  const auth = new google.auth.GoogleAuth({
    keyFile: config.gcp.credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  })

  const client = await auth.getClient()
  sheetsClient = google.sheets({ version: 'v4', auth: client })
  
  return sheetsClient
}