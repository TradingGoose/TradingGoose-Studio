import type { Hono } from 'hono'
import { authenticateRequest } from '../core/auth'
import { log } from '../core/logger'
import type { AppBindings } from '../core/types'
import { consumeUnkeyLimit } from '../services/unkey'

export const registerCoreMiddleware = (app: Hono<AppBindings>) => {
  app.use('*', async (c, next) => {
    const apiKey = c.req.header('x-api-key') || null
    const auth = await authenticateRequest(apiKey)
    if (!auth) {
      log.warn('Unauthorized request')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (!auth.isServiceKey) {
      const limit = await consumeUnkeyLimit(apiKey)
      if (!limit.allowed) {
        log.warn('Rate limit exceeded', { remaining: limit.remaining, reset: limit.reset })
        return c.json(
          { error: 'Rate limit exceeded', resetAt: limit.reset, remaining: limit.remaining },
          429
        )
      }
    }

    c.set('auth', auth)
    await next()
  })
}
