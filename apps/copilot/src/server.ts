import crypto from 'crypto'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { config } from './config'
import { authenticateRequest } from './auth'
import { generateAgentResponse } from './agent/index'
import type { AiRouterProvider } from './llm/ai-router'
import { consumeUnkeyLimit } from './unkey'
import {
  createSession,
  getSessionByChatId,
  getSessionByToolCallId,
  mapToolCall,
  closeSession,
  type Session,
} from './state'

const LOG_LEVEL = (process.env.COPILOT_LOG_LEVEL || 'debug').toLowerCase()
const shouldLog = (level: 'debug' | 'info' | 'warn' | 'error') => {
  const order = ['debug', 'info', 'warn', 'error']
  return order.indexOf(level) >= order.indexOf(LOG_LEVEL)
}
const log = {
  debug: (...args: any[]) => shouldLog('debug') && console.debug('[copilot]', ...args),
  info: (...args: any[]) => shouldLog('info') && console.info('[copilot]', ...args),
  warn: (...args: any[]) => shouldLog('warn') && console.warn('[copilot]', ...args),
  error: (...args: any[]) => shouldLog('error') && console.error('[copilot]', ...args),
}

type AppBindings = { Variables: { auth: any; rate: any } }
const app = new Hono<AppBindings>()
const COPILOT_VERSION = '1.0.2'

async function executeEditWorkflowTool(payload: any, context: { userId: string }) {
  // TODO: wire direct TradingGoose tool execution. For now, return a stub to keep parity.
  return {
    success: false,
    failedDependency: true,
    message: 'Tool execution not wired in local copilot service. Execute via TradingGoose runtime.',
    payload,
    context,
  }
}

interface RunTurnInput {
  session: Session
  userMessage: string
  contexts?: any
  userName?: string
  model?: string
  messageId?: string
  version?: string
  streamToolCalls?: boolean
  mode?: 'ask' | 'agent'
  provider?: AiRouterProvider
}

async function finalizeSession(session: Session, responseId?: string) {
  if (session.closed) return
  const id = responseId || crypto.randomUUID()
  await session.stream.writeSSE({ data: JSON.stringify({ type: 'done', data: { responseId: id } }) })
  await session.stream.writeSSE({ data: JSON.stringify({ type: 'stream_end' }) })
  session.closed = true
  closeSession(session.chatId)
  if (session.resolve) session.resolve()
}

async function runTurn(input: RunTurnInput) {
  const {
    session,
    userMessage,
    contexts,
    userName,
    model,
    messageId,
    version,
    streamToolCalls = true,
    mode,
    provider,
  } = input
  const effectiveMode = mode || session.mode || 'agent'

  const extractWorkflowSummary = (): string | undefined => {
    try {
      const reversed = [...session.messages].reverse()
      const wfTool = reversed.find((m) => m.role === 'tool' && m.name === 'get_user_workflow')
      if (!wfTool || !wfTool.content) return undefined
      const parsed = JSON.parse(wfTool.content)
      let wf = parsed?.userWorkflow || parsed?.workflow || parsed
      if (typeof wf === 'string') {
        try {
          wf = JSON.parse(wf)
        } catch {
          return undefined
        }
      }
      if (!wf || typeof wf !== 'object' || !wf.blocks || typeof wf.blocks !== 'object') {
        return undefined
      }

      const blockEntries = Object.entries<any>(wf.blocks)
      const edgeCount = Array.isArray(wf.edges) ? wf.edges.length : 0
      const blockCount = blockEntries.length
      const loopsCount =
        wf.loops && typeof wf.loops === 'object' ? Object.keys(wf.loops).length : 0
      const parallelsCount =
        wf.parallels && typeof wf.parallels === 'object' ? Object.keys(wf.parallels).length : 0
      const workflowName =
        wf.name || wf.displayName || wf.workflowName || wf.title || wf.label || undefined
      const workflowDescription =
        wf.description || wf.workflowDescription || wf.summary || wf.shortDescription || undefined

      const blockStructure = blockEntries.map(([id, block]) => ({
        id,
        type: block.type,
        name: block.name,
        enabled: block.enabled,
        advancedMode: block.advancedMode,
        triggerMode: block.triggerMode,
        inputs: block.inputs,
        outputs: block.outputs,
        connections: block.connections,
        nestedNodes: block.nestedNodes,
      }))

      const workflowPayload = {
        workflowId: session.workflowId,
        name: workflowName,
        description: workflowDescription,
        blockCount,
        edgeCount,
        loopsCount,
        parallelsCount,
        edges: Array.isArray(wf.edges) ? wf.edges : [],
        blocks: blockStructure,
      }

      const workflowJson = truncate(JSON.stringify(workflowPayload, null, 2), 20000)
      const summaryLines = [
        `Latest workflow snapshot${workflowName ? ` for "${workflowName}"` : ''}${session.workflowId ? ` (workflowId: ${session.workflowId})` : ''
        }`,
        workflowDescription ? `Description: ${workflowDescription}` : undefined,
        `- Blocks: ${blockCount}`,
        `- Connections: ${edgeCount}`,
        loopsCount || parallelsCount ? `- Loops: ${loopsCount}, Parallels: ${parallelsCount}` : undefined,
        '',
        'Workflow structure (JSON):',
        '```json',
        workflowJson,
        '```',
      ]
      return summaryLines.filter(Boolean).join('\n')
    } catch {
      return undefined
    }
  }

  const workflowSummary = extractWorkflowSummary()

  const providerToUse = provider ?? session.provider
  let agentResult: Awaited<ReturnType<typeof generateAgentResponse>>
  try {
    log.debug('Calling generateAgentResponse (streaming)', {
      mode: effectiveMode,
      model: model || session.model,
      messageLength: userMessage?.length || 0,
      historyCount: session.messages.length,
    })
    agentResult = await generateAgentResponse({
      message: userMessage,
      workflowSummary,
      contexts: contexts || undefined,
      messages: session.messages.slice(-20),
      userName,
      model: model || session.model,
      mode: effectiveMode,
      provider: providerToUse,
    })
  } catch (error) {
    log.error('generateAgentResponse failed (streaming)', { message: (error as any)?.message })
    agentResult = {
      reply: '',
      model: model || session.model || config.defaultModel,
      reasoning: undefined,
      operations: undefined,
    }
  }

  const toolCallsFromOps =
    streamToolCalls && agentResult.operations && agentResult.operations.length > 0 && (!agentResult.toolCalls || agentResult.toolCalls.length === 0)
      ? [{ id: nanoid(), name: 'edit_workflow', arguments: { operations: agentResult.operations, workflowId: session.workflowId } }]
      : []
  const toolCalls = agentResult.toolCalls?.length ? agentResult.toolCalls : toolCallsFromOps
  const normalizedToolCalls = toolCalls.map((tc) => ({
    ...tc,
    id: tc.id || nanoid(),
  }))
  // Sanitize reply: prefer plain text. If the model returned serialized JSON, extract only .reply.
  let replyText =
    agentResult.reply && agentResult.reply.length > 0
      ? agentResult.reply
      : normalizedToolCalls.length > 0
        ? `I requested the following tools: ${normalizedToolCalls.map((t) => t.name).join(', ')}. Please run them to proceed.`
        : ''

  const sanitizeReply = (text: string, fallbackToolCalls: any[]): string => {
    const tryParseReply = (value: string): string | null => {
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed.reply === 'string') {
          return parsed.reply
        }
      } catch { }
      return null
    }

    let candidate = text ?? ''
    let trimmed = candidate.trim()

    if (!trimmed && fallbackToolCalls.length > 0) {
      return `I requested the following tools: ${fallbackToolCalls.map((t) => t.name).join(', ')}. Please run them to proceed.`
    }

    // Try parsing directly
    const direct = tryParseReply(trimmed)
    if (direct !== null) return direct

    // Remove wrapping quotes (even if not escaped) and try again
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      const unquoted = trimmed.slice(1, -1)
      const unquotedParse = tryParseReply(unquoted)
      if (unquotedParse !== null) return unquotedParse
      trimmed = unquoted.trim()
    }

    // Try substring between first { and last }
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const slice = trimmed.slice(firstBrace, lastBrace + 1)
      // Strip JS-style // comments that break JSON
      const decommented = slice.replace(/\/\/[^\n\r]*/g, '')
      const sliceParse = tryParseReply(decommented)
      if (sliceParse !== null) return sliceParse
    }

    // Try unescaping if JSON was double-encoded
    if (trimmed.includes('\\"reply\\"')) {
      const unescaped = trimmed.replace(/\\"/g, '"')
      const unescapedParse = tryParseReply(unescaped)
      if (unescapedParse !== null) return unescapedParse
    }

    // Try to extract a bare "reply:" line (common when model returns pseudo-YAML)
    const replyLineMatch = trimmed.match(/^\s*reply:\s*(.+)$/m)
    if (replyLineMatch && replyLineMatch[1]) {
      return replyLineMatch[1].trim()
    }

    // Last resort: regex extract reply field
    const match = trimmed.match(/"reply"\s*:\s*"([^"]*)"/)
    if (match && match[1]) {
      return match[1]
    }

    if (trimmed.length > 0) return trimmed

    if (fallbackToolCalls.length > 0) {
      return `I requested the following tools: ${fallbackToolCalls.map((t) => t.name).join(', ')}. Please run them to proceed.`
    }

    return ''
  }

  replyText = sanitizeReply(replyText, normalizedToolCalls)

  const isAiRouterError =
    typeof replyText === 'string' &&
    (replyText.startsWith('Copilot Error:') ||
      replyText.startsWith('Copilot request failed:') ||
      replyText.startsWith('AI router request failed:') ||
      replyText.startsWith('AI router is not configured.'))

  log.info('Run turn', {
    chatId: session.chatId,
    hasTools: normalizedToolCalls.length > 0,
    model: agentResult.model,
    replyLength: replyText.length || 0,
  })

  // Emit reasoning block if present
  if (agentResult.reasoning) {
    await session.stream.writeSSE({
      data: JSON.stringify({ type: 'reasoning', data: agentResult.reasoning, phase: 'start' }),
    })
    await session.stream.writeSSE({ data: JSON.stringify({ type: 'reasoning', data: agentResult.reasoning }) })
    await session.stream.writeSSE({
      data: JSON.stringify({ type: 'reasoning', data: agentResult.reasoning, phase: 'end' }),
    })
  }

  // Handle tool calls
  if (streamToolCalls && normalizedToolCalls.length > 0) {
    // Record the assistant tool call for future turns
    session.messages.push({
      role: 'assistant',
      content: replyText,
      toolCalls: normalizedToolCalls,
    })

    for (const tc of normalizedToolCalls) {
      const tcId = tc.id || nanoid()
      session.toolCallIds.add(tcId)
      session.pendingToolCallIds.add(tcId)
      mapToolCall(tcId, session.chatId)
      await session.stream.writeSSE({
        data: JSON.stringify({
          type: 'tool_generating',
          toolCallId: tcId,
          toolName: tc.name,
        }),
      })
      await session.stream.writeSSE({
        data: JSON.stringify({
          type: 'tool_call',
          data: {
            id: tcId,
            name: tc.name,
            arguments: tc.arguments || {},
            partial: false,
          },
        }),
      })
      await session.stream.writeSSE({
        data: JSON.stringify({
          type: 'tool_result',
          toolCallId: tcId,
          success: true,
          failedDependency: false,
          result: {
            message:
              'Tool call prepared; please execute in TradingGoose client or send tool_result back to copilot.',
            arguments: tc.arguments || {},
          },
        }),
      })
    }
    // Keep stream open; await tool completion
    return
  }

  // Emit reply content
  if (replyText && replyText.trim().length > 0) {
    for (const chunk of chunkMessage(replyText)) {
      await session.stream.writeSSE({ data: JSON.stringify({ type: 'content', data: chunk }) })
    }
    session.messages.push({ role: 'assistant', content: replyText })
  }

  // Keep session open if there are pending tool calls waiting for completion (e.g., edit_workflow review flow)
  const pendingTools = session.pendingToolCallIds?.size ?? 0
  const pendingReviews = session.pendingReviewToolCallIds?.size ?? 0
  if (!isAiRouterError && pendingTools === 0 && pendingReviews === 0) {
    await finalizeSession(session, messageId || version)
  } else {
    log.info('Session kept open awaiting tool results', {
      chatId: session.chatId,
      pendingTools,
      pendingReviews,
    })
  }
}

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  workflowId: z.string().min(1),
  userId: z.string().min(1),
  stream: z.boolean().default(true),
  streamToolCalls: z.boolean().default(true),
  model: z.string().optional(),
  mode: z.enum(['ask', 'agent']).default('agent'),
  messageId: z.string().optional(),
  version: z.string().optional().default(COPILOT_VERSION),
  provider: z.any().optional(),
  conversationId: z.string().optional(),
  prefetch: z.boolean().optional(),
  userName: z.string().optional(),
  context: z
    .array(z.object({ type: z.string(), tag: z.string().optional(), content: z.string() }))
    .optional(),
  chatId: z.string().optional(),
  fileAttachments: z.any().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      })
    )
    .optional(),
})

const ContextUsageSchema = z.object({
  chatId: z.string(),
  model: z.string(),
  workflowId: z.string(),
  userId: z.string(),
  provider: z.any().optional(),
})

const MarkCompleteSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.number(),
  message: z.any().optional(),
  data: z.any().optional(),
})

const StatsSchema = z.object({
  messageId: z.string(),
  diffCreated: z.boolean(),
  diffAccepted: z.boolean(),
})

function chunkMessage(message: string): string[] {
  const pieces: string[] = []
  const sentences = message.split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    if (!sentence.trim()) continue
    if (sentence.length <= 200) {
      pieces.push(sentence)
    } else {
      for (let i = 0; i < sentence.length; i += 200) {
        pieces.push(sentence.slice(i, i + 200))
      }
    }
  }
  if (pieces.length === 0) pieces.push(message)
  return pieces
}

app.use('*', async (c, next) => {
  const apiKey = c.req.header('x-api-key') || null
  const auth = await authenticateRequest(apiKey)
  if (!auth) {
    log.warn('Unauthorized request')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Skip Unkey rate limits for trusted service key/internal callers
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

app.get('/', (c) => c.json({ status: 'ok', service: 'copilot', model: config.defaultModel }))

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
    prefetch,
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
      model: agentResult.model || model || config.defaultModel,
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

    // Keep the stream open until the session resolves (tools completed or reply finished)
    if (!session.closed) {
      await donePromise
    }
    log.info('Chat session closed', { chatId: effectiveChatId })
  })
})

app.post('/api/get-context-usage', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = ContextUsageSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
  }

  const { model, workflowId, userId } = parsed.data
  const estimatedTokens = Math.round((JSON.stringify(body).length + workflowId.length + userId.length) / 4)
  const contextWindow = 128_000
  const percentage = Math.min(100, Math.round((estimatedTokens / contextWindow) * 100))

  return c.json({
    tokensUsed: estimatedTokens,
    percentage,
    model,
    contextWindow,
    when: 'end',
  })
})

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

    // Attach tool result to history
    session.messages.push({
      role: 'tool',
      content: JSON.stringify(parsed.data.data || parsed.data.message || {}),
      name: parsed.data.name,
      toolCallId: parsed.data.id,
    })

    session.pendingToolCallIds.delete(parsed.data.id)

    // Only continue once all pending tool calls are resolved and no review is outstanding
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

app.post('/api/stats', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = StatsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
  }
  console.info('[stats]', parsed.data)
  return c.json({ success: true })
})

app.post('/api/validate-key/generate', async (c) => {
  return c.json({ apiKey: 'stub', id: 'temp' })
})

app.post('/api/validate-key/get-api-keys', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = z.object({ userId: z.string().optional() }).safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
  }
  // Stateless: return empty list; key storage handled by caller.
  return c.json([])
})

serve({
  fetch: app.fetch,
  port: config.port,
})

console.log(`Copilot service listening on http://localhost:${config.port}`)
