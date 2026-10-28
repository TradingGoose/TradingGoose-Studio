import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { anthropicProvider } from '@/providers/ai/anthropic'
import { azureAnthropicProvider } from '@/providers/ai/azure-anthropic'
import { azureOpenAIProvider } from '@/providers/ai/azure-openai'
import { bedrockProvider } from '@/providers/ai/bedrock'
import { cerebrasProvider } from '@/providers/ai/cerebras'
import { deepseekProvider } from '@/providers/ai/deepseek'
import { fireworksProvider } from '@/providers/ai/fireworks'
import { googleProvider } from '@/providers/ai/google'
import { groqProvider } from '@/providers/ai/groq'
import { mistralProvider } from '@/providers/ai/mistral'
import {
  getMaxTemperature,
  getProviderFromModel,
  MODEL_CONTROL_GETTERS,
  type ModelControl,
} from '@/providers/ai/models'
import { ollamaProvider } from '@/providers/ai/ollama'
import { openaiProvider } from '@/providers/ai/openai'
import { openRouterProvider } from '@/providers/ai/openrouter'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/ai/types'
import { withToolCosts } from '@/providers/ai/utils'
import { vertexProvider } from '@/providers/ai/vertex'
import { vllmProvider } from '@/providers/ai/vllm'
import { xAIProvider } from '@/providers/ai/xai'

const logger = createLogger('Providers')

const providers: Record<string, ProviderConfig> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  'azure-anthropic': azureAnthropicProvider,
  google: googleProvider,
  vertex: vertexProvider,
  deepseek: deepseekProvider,
  xai: xAIProvider,
  cerebras: cerebrasProvider,
  groq: groqProvider,
  mistral: mistralProvider,
  'azure-openai': azureOpenAIProvider,
  bedrock: bedrockProvider,
  fireworks: fireworksProvider,
  openrouter: openRouterProvider,
  ollama: ollamaProvider,
  vllm: vllmProvider,
}

function sanitizeRequest(request: ProviderRequest): ProviderRequest {
  const sanitizedRequest = { ...request }
  const maxTemperature = getMaxTemperature(sanitizedRequest.model)

  for (const field of ['temperature', 'maxTokens'] as const) {
    const value: unknown = sanitizedRequest[field]
    const number =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN
    const validRange =
      field === 'maxTokens'
        ? Number.isInteger(number) && number > 0
        : maxTemperature !== undefined && number >= 0 && number <= maxTemperature
    sanitizedRequest[field] = Number.isFinite(number) && validRange ? number : undefined
  }

  for (const field of Object.keys(MODEL_CONTROL_GETTERS) as ModelControl[]) {
    const value = sanitizedRequest[field]
    if (!MODEL_CONTROL_GETTERS[field](sanitizedRequest.model)?.includes(value ?? '')) {
      sanitizedRequest[field] = undefined
    }
  }

  const systemPrompt =
    typeof sanitizedRequest.systemPrompt === 'string' ? sanitizedRequest.systemPrompt : ''
  const hasSystemPrompt = systemPrompt.trim().length > 0
  sanitizedRequest.systemPrompt = hasSystemPrompt ? systemPrompt : ''

  const context =
    typeof sanitizedRequest.context === 'string' ? sanitizedRequest.context : undefined
  const hasContext = typeof context === 'string' && context.trim().length > 0
  sanitizedRequest.context = hasContext ? context : undefined

  const messages = sanitizedRequest.messages ?? []
  if (!hasContext && messages.every((message) => message.role === 'system')) {
    const content = [sanitizedRequest.systemPrompt, ...messages.map((message) => message.content)]
      .filter(Boolean)
      .join('\n\n')
    sanitizedRequest.systemPrompt = ''
    sanitizedRequest.messages = content.trim() ? [{ role: 'user', content }] : []
  }

  const hasMessages = sanitizedRequest.messages?.length

  if (!hasMessages && !hasContext && !sanitizedRequest.systemPrompt) {
    throw new Error('AI provider requests require messages, context, or a system prompt')
  }

  return sanitizedRequest
}

function isStreamingExecution(response: any): response is StreamingExecution {
  return response && typeof response === 'object' && 'stream' in response && 'execution' in response
}

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest
): Promise<ProviderResponse | StreamingExecution> {
  if (isHosted && providerId === 'ollama') {
    throw new Error('Ollama is not available on hosted instances')
  }

  const provider = providers[providerId]
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  if (getProviderFromModel(request.model) !== providerId) {
    throw new Error(`Model ${request.model} does not belong to provider ${providerId}`)
  }

  const sanitizedRequest = sanitizeRequest(request)

  // Execute the request using the provider's implementation
  const response = await provider.executeRequest(sanitizedRequest)

  // Streaming executions carry their own usage and cost metadata.
  if (isStreamingExecution(response)) {
    logger.info('Provider returned StreamingExecution')
    return response
  }

  if (response.tokens) {
    const promptTokens = response.tokens.prompt ?? response.tokens.input ?? 0
    const completionTokens = response.tokens.completion ?? response.tokens.output ?? 0

    response.tokens = {
      prompt: promptTokens,
      completion: completionTokens,
      total: response.tokens.total ?? promptTokens + completionTokens,
    }
  }

  response.cost = withToolCosts(response.cost, response.toolResults)

  return response
}
