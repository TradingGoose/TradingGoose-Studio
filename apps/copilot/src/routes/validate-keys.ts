import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppBindings } from '../core/types'

export const registerValidateKeyRoutes = (app: Hono<AppBindings>) => {
  app.post('/api/validate-key/generate', async (c) => {
    return c.json({ apiKey: 'stub', id: 'temp' })
  })

  app.post('/api/validate-key/get-api-keys', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = z.object({ userId: z.string().optional() }).safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }
    return c.json([])
  })
}
