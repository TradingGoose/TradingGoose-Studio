import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { esbuildPlugin } from '@trigger.dev/build/extensions'
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
    external: ['@mastra/code-sdk', '@mastra/core'],
    extensions: [
      esbuildPlugin({
        name: 'trigger-index-entry-points',
        setup(build) {
          const { absWorkingDir = process.cwd(), entryPoints = [] } = build.initialOptions
          const inputs = new Set(
            Object.values(entryPoints).map((entry) =>
              resolve(absWorkingDir, typeof entry === 'string' ? entry : entry.in)
            )
          )
          build.onEnd(({ metafile }) => {
            // Trigger 4.8.5 indexes local entry points, including esbuild's lazy import chunks.
            for (const output of Object.values(metafile?.outputs ?? {})) {
              if (output.entryPoint && !inputs.has(resolve(absWorkingDir, output.entryPoint))) {
                output.entryPoint = undefined
              }
            }
          })
        },
      }),
      additionalPackages({
        packages: ['unpdf'],
      }) as any,
    ],
  },
})
