import { Hono } from 'hono'
import { config } from '../core/config'
import { registerChatRoutes } from '../routes/chat'
import { registerContextUsageRoutes } from '../routes/context-usage'
import { registerStatsRoutes } from '../routes/stats'
import { registerToolRoutes } from '../routes/tools'
import { registerValidateKeyRoutes } from '../routes/validate-keys'
import type { AppBindings } from '../core/types'
import { registerCoreMiddleware } from './middleware'

export const createApp = (): Hono<AppBindings> => {
  const app = new Hono<AppBindings>()

  registerCoreMiddleware(app)

  app.get('/', (c) => c.json({ status: 'ok', service: 'copilot', model: config.defaultModel }))

  registerChatRoutes(app)
  registerContextUsageRoutes(app)
  registerToolRoutes(app)
  registerStatsRoutes(app)
  registerValidateKeyRoutes(app)

  return app
}
