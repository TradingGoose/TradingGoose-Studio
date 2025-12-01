import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppBindings } from '../core/types'
import { createApiKey, deleteApiKey, listApiKeys } from '../../db/key-store'

export const registerValidateKeyRoutes = (app: Hono<AppBindings>) => {
  app.post('/api/validate-key/generate', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = z
      .object({
        userId: z.string().optional(),
        name: z.string().optional(),
      })
      .safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const auth = c.get('auth')
    const userId = parsed.data.userId || auth?.userId
    if (!userId) {
      return c.json({ error: 'userId is required' }, 400)
    }

    try {
      const created = await createApiKey(userId, parsed.data.name)
      return c.json({ apiKey: created.apiKey, id: created.id }, 201)
    } catch (error: any) {
      return c.json({ error: error?.message || 'Failed to create key' }, 500)
    }
  })

  app.post('/api/validate-key/get-api-keys', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = z
      .object({
        userId: z.string().optional(),
      })
      .safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const auth = c.get('auth')
    const userId = parsed.data.userId || auth?.userId
    if (!userId) {
      return c.json({ error: 'userId is required' }, 400)
    }

    const keys = (await listApiKeys(userId)).map((k) => ({
      id: k.id,
      apiKey: k.suffix ? `*****${k.suffix}` : '',
    }))

    return c.json(keys)
  })

  app.post('/api/validate-key/delete', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = z
      .object({
        apiKeyId: z.string(),
        userId: z.string().optional(),
      })
      .safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const auth = c.get('auth')
    const userId = parsed.data.userId || auth?.userId
    if (!userId) {
      return c.json({ error: 'userId is required' }, 400)
    }

    const ok = await deleteApiKey(parsed.data.apiKeyId, userId)
    if (!ok) return c.json({ error: 'Failed to delete key' }, 500)

    return c.json({ success: true })
  })
}
