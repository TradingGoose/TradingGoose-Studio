import { additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { config as loadDotEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './lib/env'

const configDir = dirname(fileURLToPath(import.meta.url))
loadDotEnv({ path: resolve(configDir, '.env') })

const triggerProjectRef = process.env.TRIGGER_PROJECT_REF ?? process.env.TRIGGER_PROJECT_ID

if (!triggerProjectRef) {
  throw new Error('Missing TRIGGER_PROJECT_REF or TRIGGER_PROJECT_ID for Trigger.dev project configuration.')
}

export default defineConfig({
  project: env.TRIGGER_PROJECT_ID! || triggerProjectRef,
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
