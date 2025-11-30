import crypto from 'crypto'
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { nanoid } from 'nanoid'
import { generateAgentResponse } from '../agent'
import { config } from '../core/config'
import { runTurn } from '../chat/engine'
import { log } from '../core/logger'
import { ChatRequestSchema } from '../core/schemas'
import { createSession, type Session } from '../chat/state'
import { normalizeUsage, recordUsageSnapshot } from '../services/usage'
import type { AppBindings } from '../core/types'

export const registerChatRoutes = (app: Hono<AppBindings>) => {
  app.post('/api/chat-completion-streaming', async (c) => {
    const body = await c.req.json()
    const parsed = ChatRequestSchema.safeParse(body)
    if (!parsed.success) {
      log.warn('Invalid chat request body', parsed.error.issues)
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const {
      message,
      workflowId,
      userId,
      chatId,
      model,
      stream = true,
      context,
      userName,
      messageId,
      version,
      streamToolCalls,
      mode,
      provider,
      conversationId,
      messages,
    } = parsed.data

    const effectiveMode = mode || 'agent'
    const effectiveChatId = chatId || `chat_${nanoid()}`
    const responseId = crypto.randomUUID()

    if (!stream) {
      const history =
        Array.isArray(messages) && messages.length > 0
          ? messages.map((m) => ({ role: m.role, content: m.content }))
          : []
      log.debug('Calling generateAgentResponse (non-stream)', {
        mode: effectiveMode,
        model,
        messageLength: message?.length || 0,
        historyCount: history.length,
      })
      let agentResult: Awaited<ReturnType<typeof generateAgentResponse>>
      try {
        agentResult = await generateAgentResponse({
          message,
          workflowSummary: undefined,
          contexts: context || undefined,
          messages: history,
          userName,
          model,
          mode: effectiveMode,
          provider,
        })
      } catch (error) {
        log.error('generateAgentResponse failed (non-stream)', { message: (error as any)?.message })
        agentResult = {
          reply: '',
          model: model || config.defaultModel,
          reasoning: undefined,
          operations: undefined,
        }
      }

      const modelUsed = agentResult.model || model || config.defaultModel
      const normalizedUsage = normalizeUsage(agentResult.tokenUsage ?? agentResult.usage, agentResult.tokens)
      if (agentResult.tokenUsage || agentResult.usage || agentResult.tokens) {
        recordUsageSnapshot(
          effectiveChatId,
          modelUsed,
          agentResult.usage,
          agentResult.tokenUsage,
          agentResult.tokens
        )
      }

      const toolCallsFromOps =
        agentResult.operations &&
          agentResult.operations.length > 0 &&
          (!agentResult.toolCalls || agentResult.toolCalls.length === 0)
          ? [
            {
              id: nanoid(),
              name: 'edit_workflow',
              arguments: { operations: agentResult.operations, workflowId },
            },
          ]
          : []
      const toolCalls = agentResult.toolCalls?.length ? agentResult.toolCalls : toolCallsFromOps
      const normalizedToolCalls = toolCalls.map((tc) => ({ ...tc, id: tc.id || nanoid() }))
      const replyText =
        agentResult.reply && agentResult.reply.length > 0
          ? agentResult.reply
          : normalizedToolCalls.length > 0
            ? `I requested the following tools: ${normalizedToolCalls.map((t) => t.name).join(', ')}. Please run them to proceed.`
            : ''

      return c.json({
        content: replyText,
        reasoning: agentResult.reasoning,
        operations: agentResult.operations,
        toolCalls: normalizedToolCalls,
        model: modelUsed,
        tokens:
          agentResult.tokens ||
          agentResult.tokenUsage ||
          agentResult.usage ||
          (normalizedUsage.totalTokens
            ? {
                total_tokens: normalizedUsage.totalTokens,
                prompt_tokens: normalizedUsage.promptTokens,
                completion_tokens: normalizedUsage.completionTokens,
              }
            : undefined),
        tokenUsage: agentResult.tokenUsage ?? normalizedUsage.raw,
        usage:
          agentResult.usage ??
          agentResult.tokenUsage ??
          agentResult.tokens ??
          (normalizedUsage.totalTokens
            ? {
                total_tokens: normalizedUsage.totalTokens,
                prompt_tokens: normalizedUsage.promptTokens,
                completion_tokens: normalizedUsage.completionTokens,
              }
            : undefined),
      })
    }

    return streamSSE(c, async (stream) => {
      let resolveDone: () => void
      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve
      })

      const history: Session['messages'] =
        Array.isArray(messages) && messages.length > 0
          ? messages.map((m) => ({ role: m.role, content: m.content }))
          : []

      const session: Session = {
        chatId: effectiveChatId,
        userId,
        workflowId,
        mode,
        model,
        provider,
        stream,
        messages: [...history, { role: 'user', content: message }],
        toolCallIds: new Set(),
        pendingToolCallIds: new Set(),
        pendingReviewToolCallIds: new Set(),
        lastUserMessage: message,
        closed: false,
        resolve: resolveDone!,
      }
      createSession(session)
      log.info('Chat session created', {
        chatId: effectiveChatId,
        userId,
        workflowId,
        model,
        messageLength: message.length,
      })

      await stream.writeSSE({
        data: JSON.stringify({ type: 'chat_id', chatId: effectiveChatId }),
      })
      await stream.writeSSE({
        data: JSON.stringify({ type: 'start', data: { responseId, messageId, version, conversationId } }),
      })

      await runTurn({
        session,
        userMessage: message,
        contexts: context,
        userName,
        model,
        messageId,
        version,
        streamToolCalls,
        mode,
        provider,
      })

      if (!session.closed) {
        await donePromise
      }
      log.info('Chat session closed', { chatId: effectiveChatId })
    })
  })
}
