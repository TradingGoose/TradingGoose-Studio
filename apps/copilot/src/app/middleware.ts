import type { Hono } from 'hono'
import { authenticateRequest } from '../core/auth'
import { log } from '../core/logger'
import type { AppBindings } from '../core/types'

export const registerCoreMiddleware = (app: Hono<AppBindings>) => {
  app.use('*', async (c, next) => {
    const apiKey = c.req.header('x-api-key') || null
    const auth = await authenticateRequest(apiKey)
    if (!auth) {
      log.warn('Unauthorized request')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('auth', auth)
    await next()
  })
}
