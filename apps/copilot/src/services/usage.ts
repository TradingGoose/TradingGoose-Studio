import { DEFAULT_CONTEXT_WINDOW } from '../core/constants'

export type UsageSnapshot = {
  tokensUsed?: number
  percentage?: number
  model?: string
  contextWindow?: number
  usage?: any
  tokenUsage?: any
  tokens?: any
  normalizedUsage?: NormalizedUsage
  updatedAt: number
}

export type NormalizedUsage = {
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  contextWindow?: number
  raw?: any
}

const usageByChatId = new Map<string, UsageSnapshot>()

const extractTotalTokens = (usage: any): number | undefined => {
  if (!usage || typeof usage !== 'object') {
    return typeof usage === 'number' && !Number.isNaN(usage) ? usage : undefined
  }

  const direct =
    usage.total_tokens ??
    usage.totalTokens ??
    usage.total ??
    usage.token_count ??
    usage.tokens
  if (typeof direct === 'number' && !Number.isNaN(direct)) return direct

  const prompt =
    usage.prompt_tokens ??
    usage.promptTokens ??
    usage.input_tokens ??
    usage.inputTokens ??
    usage.prompt
  const completion =
    usage.completion_tokens ??
    usage.completionTokens ??
    usage.output_tokens ??
    usage.outputTokens ??
    usage.completion

  if (typeof prompt === 'number' || typeof completion === 'number') {
    const safePrompt = typeof prompt === 'number' && !Number.isNaN(prompt) ? prompt : 0
    const safeCompletion =
      typeof completion === 'number' && !Number.isNaN(completion) ? completion : 0
    return safePrompt + safeCompletion
  }

  return undefined
}

const extractContextWindow = (usage: any): number | undefined => {
  if (!usage || typeof usage !== 'object') return undefined
  const candidate =
    usage.context_window ??
    usage.contextWindow ??
    usage.max_context_length ??
    usage.max_input_tokens ??
    usage.maximum_context_length
  return typeof candidate === 'number' && !Number.isNaN(candidate) ? candidate : undefined
}

export const normalizeUsage = (usage?: any, tokens?: any): NormalizedUsage => {
  const source = usage ?? tokens
  if (!source) return {}

  const promptTokens =
    source.prompt_tokens ??
    source.promptTokens ??
    source.input_tokens ??
    source.inputTokens ??
    source.prompt

  const completionTokens =
    source.completion_tokens ??
    source.completionTokens ??
    source.output_tokens ??
    source.outputTokens ??
    source.completion

  const totalTokens =
    source.total_tokens ??
    source.totalTokens ??
    source.total ??
    source.token_count ??
    source.tokens ??
    (typeof promptTokens === 'number' && typeof completionTokens === 'number'
      ? promptTokens + completionTokens
      : undefined)

  const contextWindow = extractContextWindow(source)

  return {
    totalTokens: typeof totalTokens === 'number' && !Number.isNaN(totalTokens) ? totalTokens : undefined,
    promptTokens: typeof promptTokens === 'number' && !Number.isNaN(promptTokens) ? promptTokens : undefined,
    completionTokens:
      typeof completionTokens === 'number' && !Number.isNaN(completionTokens) ? completionTokens : undefined,
    contextWindow,
    raw: source,
  }
}

export const recordUsageSnapshot = (
  chatId: string,
  model: string | undefined,
  usage?: any,
  tokenUsage?: any,
  tokens?: any
) => {
  const normalized = normalizeUsage(tokenUsage ?? usage, tokens)
  const tokensUsed =
    normalized.totalTokens ??
    extractTotalTokens(tokenUsage) ??
    extractTotalTokens(usage) ??
    extractTotalTokens(tokens)

  const contextWindow =
    normalized.contextWindow ??
    extractContextWindow(tokenUsage) ??
    extractContextWindow(usage) ??
    DEFAULT_CONTEXT_WINDOW

  const percentage =
    tokensUsed !== undefined && contextWindow
      ? Math.min(100, (tokensUsed / contextWindow) * 100)
      : undefined

  usageByChatId.set(chatId, {
    tokensUsed,
    percentage,
    model,
    contextWindow,
    usage,
    tokenUsage,
    tokens,
    normalizedUsage: normalized,
    updatedAt: Date.now(),
  })

  return usageByChatId.get(chatId)
}

export const getUsageSnapshot = (chatId: string) => usageByChatId.get(chatId)

export const estimateTokensFallback = (body: any, workflowId: string, userId: string) =>
  Math.round((JSON.stringify(body).length + workflowId.length + userId.length) / 4)
