import { serve } from '@hono/node-server'
import { config } from './core/config'
import { log } from './core/logger'
import { createApp } from './app/create-app'

const app = createApp()

serve({
  fetch: app.fetch,
  port: config.port,
})

log.info(`Copilot service listening on http://localhost:${config.port}`)
