import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { config as loadDotEnv } from 'dotenv'
import { env } from './lib/env'

const configDir = dirname(fileURLToPath(import.meta.url))
loadDotEnv({ path: resolve(configDir, '.env') })

const triggerProjectId = env.TRIGGER_PROJECT_ID?.trim() || process.env.TRIGGER_PROJECT_ID?.trim()

if (!triggerProjectId) {
  throw new Error('Missing TRIGGER_PROJECT_ID for Trigger.dev project configuration.')
}

export default defineConfig({
  project: triggerProjectId,
  runtime: 'node',
  logLevel: 'log',
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
  build: {
    extensions: [
      additionalPackages({
        packages: ['unpdf'],
      }) as any,
    ],
  },
})
