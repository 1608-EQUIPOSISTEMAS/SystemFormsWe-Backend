import { Storage } from '@google-cloud/storage'
import { config } from './env.js'

export const storage = new Storage({
  projectId: config.gcp.projectId,
  keyFilename: config.gcp.credentialsPath
})

export const bucket = storage.bucket(config.gcp.bucket)