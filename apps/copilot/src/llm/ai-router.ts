import { config } from '../core/config'

export interface AiRouterCompletion {
  content: string
  reasoning?: string
  operations?: any[]
  model: string
  toolCalls?: Array<{ id?: string; name: string; arguments?: Record<string, any> }>
  usage?: any
  tokenUsage?: any
  tokens?: any
}

export interface AiRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export interface AiRouterTool {
  type: 'function'
  function: { name: string; description?: string; parameters?: Record<string, any> }
}

export interface AiRouterProvider {
  provider: string
  model?: string
}

export interface AiRouterRequest {
  messages: AiRouterMessage[]
  tools?: AiRouterTool[]
  toolChoice?: 'auto' | 'none'
  model?: string
  mode?: 'ask' | 'agent'
  provider?: AiRouterProvider
}

type ProviderPattern = { provider: string; pattern: RegExp }

const PROVIDER_PATTERNS: ProviderPattern[] = [
  { provider: 'openai', pattern: /^(gpt|o\d|text-embedding|o-)/i },
  { provider: 'anthropic', pattern: /(claude|sonnet)/i },
  { provider: 'google', pattern: /gemini/i },
  { provider: 'mistral', pattern: /^(magistral|mistral|open-mistral|ministral|codestral)/i },
  { provider: 'groq', pattern: /^(grok|groq)/i },
  { provider: 'xai', pattern: /^x(?:ai)?/i },
  { provider: 'cerebras', pattern: /^(cerebras|jeff)/i },
  { provider: 'deepseek', pattern: /deepseek/i },
]

function guessProviderForModel(model: string): string {
  const normalized = model.toLowerCase()
  for (const entry of PROVIDER_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return entry.provider
    }
  }
  return 'openai'
}

function ensureProviderPrefix(model: string, provider?: string): string {
  if (model.includes('/')) return model
  const providerId = provider || guessProviderForModel(model)
  return `${providerId}/${model}`
}

function formatModelForRouter(model?: string, provider?: AiRouterProvider): string {
  const candidate = (model || provider?.model || config.defaultModel || '').trim()
  if (!candidate) return candidate
  if (!provider) return ensureProviderPrefix(candidate)
  return ensureProviderPrefix(candidate, provider.provider)
}

export async function getAiRouterCompletion(input: AiRouterRequest): Promise<AiRouterCompletion> {
  const routerUrl = config.routerUrl
  const routerKey = config.routerApiKey
  const hasTools = (input.tools?.length ?? 0) > 0
  try {
    console.info('[copilot][ai-router] preparing request', {
      mode: input.mode || 'unknown',
      allowedTools: input.tools?.map((t) => t.function?.name || t.type) || [],
      hasRouterUrl: !!routerUrl,
      hasRouterKey: !!routerKey,
      useOpenRouter: config.useOpenRouter,
    })
  } catch {
    // ignore logging errors
  }

  if (!routerKey) {
    try {
      console.warn('[copilot][ai-router] missing config; not sending to AI router', {
        hasRouterKey: !!routerKey,
      })
    } catch {
      // ignore logging errors
    }
    return {
      content:
        'AI router is not configured. Set AI_ROUTER_API_KEY (and optional AI_ROUTER_URL if you host a custom endpoint).',
      model: input.model || config.defaultModel,
    }
  }

  const resolvedModel = config.useOpenRouter
    ? formatModelForRouter(input.model, input.provider)
    : input.model || config.defaultModel

  const body = {
    model: resolvedModel,
    stream: false,
    messages: input.messages,
    tools: input.tools || [],
    tool_choice: input.toolChoice || (hasTools ? ('auto' as const) : ('none' as const)),
  }

  const endpointBase = routerUrl.replace(/\/$/, '')
  const url = `${endpointBase}/chat/completions`

  let res: Response
  try {
    try {
      console.info('[copilot][ai-router] sending request', {
        url,
        mode: input.mode || 'unknown',
        model: body.model,
        tools: body.tools.map((t) => t.function?.name || t.type),
        messageLength: input.messages?.at(-1)?.content?.length || 0,
        historyCount: input.messages?.length || 0,
      })
    } catch {
      // ignore logging errors
    }
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${routerKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error: any) {
    try {
      console.error('[copilot][ai-router] fetch error', { message: error?.message })
    } catch {
      // ignore logging errors
    }
    return {
      content: `AI router request failed: ${error?.message || 'Unknown error'}`,
      model: body.model,
    }
  }

  const readErrorText = async (response: Response): Promise<string> => {
    try {
      const text = await response.text()
      return text.length > 2000
        ? `${text.slice(0, 2000)}...[truncated ${text.length - 2000} chars]`
        : text
    } catch {
      return ''
    }
  }

  if (!res.ok) {
    try {
      console.warn('[copilot][ai-router] retrying once without tools after non-200', {
        status: res.status,
        statusText: res.statusText,
      })
      const errorText = await readErrorText(res)
      if (errorText) {
        console.warn('[copilot][ai-router] original error body', errorText)
      }
      const retryBody = { ...body, tools: [], tool_choice: 'none' as const }
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${routerKey}`,
        },
        body: JSON.stringify(retryBody),
      })
      if (retryRes.ok) {
        res = retryRes
      } else {
        try {
          console.error('[copilot][ai-router] retry failed', {
            status: retryRes.status,
            statusText: retryRes.statusText,
          })
          const retryError = await readErrorText(retryRes)
          if (retryError) {
            console.error('[copilot][ai-router] retry error body', retryError)
          }
        } catch {
          // ignore logging inside retry
        }
      }
    } catch {
      // ignore retry errors
    }
  }

  if (!res.ok) {
    const errorText = await readErrorText(res)
    try {
      console.error('[copilot][ai-router] non-200 response', {
        status: res.status,
        statusText: res.statusText,
        body: errorText,
      })
    } catch {
      // ignore logging errors
    }
    return {
      content: `Copilot Error: ${res.status} ${res.statusText}${
        errorText ? ` - ${errorText}` : ''
      }`,
      model: body.model,
    }
  }
  try {
    console.info('[copilot][ai-router] response ok', { status: res.status })
  } catch {
    // ignore logging errors
  }

  const json = (await res.json().catch((err) => {
    try {
      console.error('[copilot][ai-router] failed to parse JSON', { message: err?.message })
    } catch {
      // ignore logging errors
    }
    return null
  })) as any
  const message = json?.choices?.[0]?.message || {}
  const rawContent = message?.content || json?.content || ''
  const rawUsage = json?.usage
  const rawTokenUsage = json?.token_usage || rawUsage
  const rawTokens = json?.tokens

  let toolCalls: Array<{ id?: string; name: string; arguments?: Record<string, any> }> | undefined
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    toolCalls = message.tool_calls.map((tc: any) => {
      let parsedArgs: Record<string, any> | undefined
      try {
        parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined
      } catch {
        parsedArgs = undefined
      }
      return {
        id: tc.id,
        name: tc.function?.name || tc.name,
        arguments: parsedArgs,
      }
    })
  }

  let content = ''
  let reasoning: string | undefined
  let operations: any[] | undefined

  if (typeof rawContent === 'string') {
    content = rawContent
    try {
      const parsed = JSON.parse(rawContent)
      content = typeof parsed.reply === 'string' ? parsed.reply : content
      reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : reasoning
      operations = Array.isArray(parsed.operations) ? parsed.operations : operations
      if (parsed.toolCalls && Array.isArray(parsed.toolCalls)) {
        toolCalls = parsed.toolCalls
      }
    } catch {
      // ignore parse errors
    }
  } else if (rawContent && typeof rawContent === 'object') {
    const maybe = rawContent as any
    const candidateReply =
      typeof maybe.reply === 'string'
        ? maybe.reply
        : typeof maybe.content === 'string'
        ? maybe.content
        : null
    if (candidateReply) {
      content = candidateReply
    } else {
      try {
        content = JSON.stringify(maybe)
      } catch {
        content = ''
      }
    }
    if (typeof maybe.reasoning === 'string') reasoning = maybe.reasoning
    if (Array.isArray(maybe.operations)) operations = maybe.operations
    if (maybe.toolCalls && Array.isArray(maybe.toolCalls)) toolCalls = maybe.toolCalls
  }

  return {
    content,
    reasoning,
    operations,
    model: json?.model || body.model,
    toolCalls,
    usage: rawUsage,
    tokenUsage: rawTokenUsage,
    tokens: rawTokens,
  }
}
