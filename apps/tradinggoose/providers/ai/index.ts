import { isHosted } from '@/lib/environment'
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
import { supportsTemperature } from '@/providers/ai/models'
import { ollamaProvider } from '@/providers/ai/ollama'
import { openaiProvider } from '@/providers/ai/openai'
import { openRouterProvider } from '@/providers/ai/openrouter'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/ai/types'
import { calculateCost } from '@/providers/ai/utils'
import { vertexProvider } from '@/providers/ai/vertex'
import { vllmProvider } from '@/providers/ai/vllm'
import { xAIProvider } from '@/providers/ai/xai'

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

function isStreamingExecution(response: any): response is StreamingExecution {
  return response && typeof response === 'object' && 'stream' in response && 'execution' in response
}

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest
): Promise<ProviderResponse | ReadableStream | StreamingExecution> {
  if (isHosted && providerId === 'ollama') {
    throw new Error('Ollama is not available on hosted instances')
  }

  const provider = providers[providerId]
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  const response = await provider.executeRequest({
    ...request,
    temperature: supportsTemperature(request.model) ? request.temperature : undefined,
  })

  if (isStreamingExecution(response) || response instanceof ReadableStream) {
    return response
  }

  if (response.tokens) {
    const promptTokens = response.tokens.prompt ?? response.tokens.input ?? 0
    const completionTokens = response.tokens.completion ?? response.tokens.output ?? 0
    const useCachedInput = !!request.context && request.context.length > 0

    response.cost = calculateCost(response.model, promptTokens, completionTokens, useCachedInput)
  }

  return response
}
