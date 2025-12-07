import crypto from 'crypto'
import { nanoid } from 'nanoid'
import { config } from '../core/config'
import { generateAgentResponse } from '../agent'
import type { AiRouterProvider } from '../llm/ai-router'
import { log } from '../core/logger'
import { recordUsageSnapshot } from '../services/usage'
import { mapToolCall, closeSession, type Session } from './state'
import { billingConfig, postContextUsage, validateUsageLimit } from '../services/billing'
import type { AuthContext } from '../core/auth'

export interface RunTurnInput {
  session: Session
  userMessage: string
  contexts?: any
  userName?: string
  model?: string
  messageId?: string
  version?: string
  streamToolCalls?: boolean
  mode?: 'ask' | 'agent' | 'wand'
  provider?: AiRouterProvider
  systemPrompt?: string
  auth?: AuthContext | null
}

const chunkMessage = (message: string): string[] => {
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

export async function finalizeSession(session: Session, responseId?: string) {
  if (session.closed) return
  const id = responseId || crypto.randomUUID()
  await session.stream.writeSSE({ data: JSON.stringify({ type: 'done', data: { responseId: id } }) })
  await session.stream.writeSSE({ data: JSON.stringify({ type: 'stream_end' }) })
  session.closed = true
  closeSession(session.chatId)
  if (session.resolve) session.resolve()
}

export async function runTurn(input: RunTurnInput) {
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
    systemPrompt,
    auth,
  } = input
  const effectiveMode = mode || session.mode || 'agent'
  const billingEnabled = billingConfig.internalApiSecret && billingConfig.officialTgUrl
  const billingAssistantId = messageId || crypto.randomUUID()

  const workflowSummary = (() => {
    const wfTool = [...session.messages]
      .reverse()
      .find((m) => m.role === 'tool' && m.name === 'get_user_workflow')
    if (!wfTool?.content) return undefined
    return typeof wfTool.content === 'string'
      ? wfTool.content
      : JSON.stringify(wfTool.content, null, 2)
  })()

  const providerToUse = provider ?? session.provider

  // Validate usage before generating a new response to avoid overspending during long sessions
  if (billingEnabled && session.userId) {
    const usageCheck = await validateUsageLimit({
      userId: session.userId,
      officialTgUrl: billingConfig.officialTgUrl,
      internalApiSecret: billingConfig.internalApiSecret,
    })
    if (!usageCheck.allowed) {
      const usageMessage =
        'Usage limit exceeded. To continue using this service, upgrade your plan or top up on credits.'
      log.info('Usage exceeded during runTurn; aborting generation', {
        chatId: session.chatId,
        userId: session.userId,
        status: usageCheck.status,
      })
      // Send a user-visible content chunk so the frontend shows the usage message even on stream error
      await session.stream.writeSSE({
        data: JSON.stringify({ type: 'content', data: usageMessage }),
      })
      await session.stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          data: usageMessage,
          error: usageMessage,
          status: usageCheck.status ?? 402,
        }),
      })
      await finalizeSession(session, session.conversationId)
      return
    }
  }

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
      appendUserMessage: false,
      customSystemPrompt: systemPrompt,
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

  const modelUsed = agentResult.model || model || session.model || config.defaultModel
  if (agentResult.tokenUsage || agentResult.usage || agentResult.tokens) {
    recordUsageSnapshot(
      session.chatId,
      modelUsed,
      agentResult.usage,
      agentResult.tokenUsage,
      agentResult.tokens
    )
  }

  const shouldBill = billingEnabled && !!session.userId
  if (shouldBill) {
    const billingResult = await postContextUsage({
      chatId: session.chatId,
      model: modelUsed,
      workflowId: session.workflowId,
      userId: session.userId,
      provider: providerToUse,
      assistantMessageId: billingAssistantId,
    })
    if (!billingResult.success) {
      log.warn('Context usage billing failed (stream)', {
        userId: session.userId,
        status: billingResult.status,
        error: billingResult.error,
      })
    }
  }

  const toolCallsFromOps =
    streamToolCalls &&
      agentResult.operations &&
      agentResult.operations.length > 0 &&
      (!agentResult.toolCalls || agentResult.toolCalls.length === 0)
      ? [
        { id: nanoid(), name: 'edit_workflow', arguments: { operations: agentResult.operations, workflowId: session.workflowId } },
      ]
      : []
  const toolCalls = agentResult.toolCalls?.length ? agentResult.toolCalls : toolCallsFromOps
  const normalizedToolCalls = toolCalls.map((tc) => ({
    ...tc,
    id: tc.id || nanoid(),
  }))
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

    const direct = tryParseReply(trimmed)
    if (direct !== null) return direct

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      const unquoted = trimmed.slice(1, -1)
      const unquotedParse = tryParseReply(unquoted)
      if (unquotedParse !== null) return unquotedParse
      trimmed = unquoted.trim()
    }

    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const slice = trimmed.slice(firstBrace, lastBrace + 1)
      const decommented = slice.replace(/\/\/[^\n\r]*/g, '')
      const sliceParse = tryParseReply(decommented)
      if (sliceParse !== null) return sliceParse
    }

    if (trimmed.includes('\\"reply\\"')) {
      const unescaped = trimmed.replace(/\\"/g, '"')
      const unescapedParse = tryParseReply(unescaped)
      if (unescapedParse !== null) return unescapedParse
    }

    const replyLineMatch = trimmed.match(/^\s*reply:\s*(.+)$/m)
    if (replyLineMatch && replyLineMatch[1]) {
      return replyLineMatch[1].trim()
    }

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

  if (agentResult.reasoning) {
    await session.stream.writeSSE({
      data: JSON.stringify({ type: 'reasoning', data: agentResult.reasoning, phase: 'start' }),
    })
    await session.stream.writeSSE({ data: JSON.stringify({ type: 'reasoning', data: agentResult.reasoning }) })
    await session.stream.writeSSE({
      data: JSON.stringify({ type: 'reasoning', data: agentResult.reasoning, phase: 'end' }),
    })
  }

  if (streamToolCalls && normalizedToolCalls.length > 0) {
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
    return
  }

  if (isAiRouterError) {
    const statusMatch = replyText.match(/copilot error:\s*(\d{3})/i)
    const inferredStatus = statusMatch ? Number.parseInt(statusMatch[1], 10) : undefined
    // Send a single error and close the stream to avoid duplicated text
    await session.stream.writeSSE({
      data: JSON.stringify({
        type: 'error',
        data: replyText,
        error: replyText,
        status: inferredStatus,
      }),
    })
    await finalizeSession(session, session.conversationId)
    return
  }

  if (replyText && replyText.trim().length > 0) {
    for (const chunk of chunkMessage(replyText)) {
      await session.stream.writeSSE({ data: JSON.stringify({ type: 'content', data: chunk }) })
    }
    session.messages.push({ role: 'assistant', content: replyText })
  }

  const pendingTools = session.pendingToolCallIds?.size ?? 0
  const pendingReviews = session.pendingReviewToolCallIds?.size ?? 0
  if (pendingTools === 0 && pendingReviews === 0) {
    await finalizeSession(session, session.conversationId)
  } else {
    log.info('Session kept open awaiting tool results', {
      chatId: session.chatId,
      pendingTools,
      pendingReviews,
    })
  }
}
