import type { Hono } from 'hono'
import { StatsSchema } from '../core/schemas'
import type { AppBindings } from '../core/types'

export const registerStatsRoutes = (app: Hono<AppBindings>) => {
  app.post('/api/stats', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = StatsSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }
    console.info('[stats]', parsed.data)
    return c.json({ success: true })
  })
}
