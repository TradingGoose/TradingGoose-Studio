import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { config as loadDotEnv } from 'dotenv'
import { env } from './lib/env'

const configDir = dirname(fileURLToPath(import.meta.url))
loadDotEnv({ path: resolve(configDir, '.env') })
const triggerProjectId = env.TRIGGER_PROJECT_ID || process.env.TRIGGER_PROJECT_ID

export default defineConfig({
  project: triggerProjectId!,
  runtime: 'node',
  logLevel: 'log',
  maxDuration: 600,
  machine: "small-2x",
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
