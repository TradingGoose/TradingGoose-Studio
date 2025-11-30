import type { Hono } from 'hono'
import { COPILOT_VERSION } from '../core/constants'
import { log } from '../core/logger'
import { MarkCompleteSchema } from '../core/schemas'
import { getSessionByToolCallId } from '../chat/state'
import { runTurn } from '../chat/engine'
import type { AppBindings } from '../core/types'

export const registerToolRoutes = (app: Hono<AppBindings>) => {
  app.post('/api/tools/mark-complete', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = MarkCompleteSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }
    log.info('[tools/mark-complete]', parsed.data)

    const session = getSessionByToolCallId(parsed.data.id)
    if (session) {
      log.info('[tools/mark-complete] resolved session', {
        toolCallId: parsed.data.id,
        name: parsed.data.name,
        status: parsed.data.status,
        message: parsed.data.message,
        mode: session.mode,
        pendingToolCallCount: session.pendingToolCallIds.size,
        pendingReviewCount: session.pendingReviewToolCallIds.size,
      })

      await session.stream.writeSSE({
        data: JSON.stringify({
          type: 'tool_result',
          toolCallId: parsed.data.id,
          success: parsed.data.status >= 200 && parsed.data.status < 300,
          failedDependency: false,
          result: parsed.data.data || { message: parsed.data.message },
        }),
      })

      session.messages.push({
        role: 'tool',
        content: JSON.stringify(parsed.data.data || parsed.data.message || {}),
        name: parsed.data.name,
        toolCallId: parsed.data.id,
      })

      session.pendingToolCallIds.delete(parsed.data.id)

      if (session.pendingToolCallIds.size === 0 && session.pendingReviewToolCallIds.size === 0) {
        await runTurn({
          session,
          userMessage: session.lastUserMessage,
          contexts: undefined,
          userName: undefined,
          model: session.model,
          messageId: undefined,
          version: COPILOT_VERSION,
          streamToolCalls: true,
          mode: session.mode,
          provider: session.provider,
        })
        log.info('[tools/mark-complete] follow-up turn triggered', { toolCallId: parsed.data.id })
        return c.json({ success: true, continued: true })
      }

      log.info('[tools/mark-complete] waiting for remaining tool results', {
        pendingToolCallCount: session.pendingToolCallIds.size,
        pendingReviewCount: session.pendingReviewToolCallIds.size,
      })
      return c.json({ success: true, continued: false })
    }

    log.warn('[tools/mark-complete] No active session for tool', { toolCallId: parsed.data.id })
    return c.json({ success: true, continued: false })
  })
}
