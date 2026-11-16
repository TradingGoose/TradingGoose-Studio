import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { config as loadDotEnv } from 'dotenv'

const configDir = dirname(fileURLToPath(import.meta.url))
loadDotEnv({ path: resolve(configDir, '.env') })
const triggerProjectId = process.env.TRIGGER_PROJECT_ID

export default defineConfig({
  project: triggerProjectId!,
  runtime: 'node-24',
  logLevel: 'log',
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background/tasks'],
  build: {
    extensions: [
      additionalPackages({
        packages: ['unpdf'],
      }) as any,
    ],
  },
})
