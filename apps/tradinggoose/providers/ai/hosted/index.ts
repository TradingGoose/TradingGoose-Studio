import {
  formatCompletionModel,
  readCompletionDeltaText,
  readCompletionError,
  readCompletionMessageText,
} from '@/lib/copilot/completion'
import {
  COPILOT_RUNTIME_MODEL_CONFIGS,
  type CopilotRuntimeModel,
  type CopilotRuntimeProviderId,
} from '@/lib/copilot/runtime-models'
import { proxyCopilotCompletionRequest } from '@/app/api/copilot/proxy'
import { getProviderDefaultModel, getProviderModels } from '@/providers/ai/models'
import type {
  Message,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
} from '@/providers/ai/types'

type HostedRuntimeModel = {
  id: string
  provider: CopilotRuntimeProviderId
  model: CopilotRuntimeModel
}

const HOSTED_MODELS: HostedRuntimeModel[] = COPILOT_RUNTIME_MODEL_CONFIGS.map(
  ({ provider, model }) => ({
    id: `hosted/${provider}/${model}`,
    provider,
    model,
  })
)

function resolveHostedRuntimeModel(model: string): HostedRuntimeModel {
  const hostedModel = HOSTED_MODELS.find((entry) => entry.id === model.trim())
  if (!hostedModel) {
    throw new Error(`Unsupported hosted model: ${model}`)
  }
  return hostedModel
}

function readUsage(payload: any) {
  const usage = payload?.usage ?? {}
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0
  const completion = usage.completion_tokens ?? usage.output_tokens ?? 0

  return {
    prompt,
    completion,
    total: usage.total_tokens ?? prompt + completion,
  }
}

function buildMessages(request: ProviderRequest): Message[] {
  return [
    ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
    ...(request.context ? [{ role: 'user' as const, content: request.context }] : []),
    ...(request.messages ?? []),
  ]
}

function buildPayload(request: ProviderRequest, stream: boolean) {
  const hostedModel = resolveHostedRuntimeModel(request.model)
  const payload: Record<string, unknown> = {
    model: formatCompletionModel(hostedModel.model, hostedModel.provider),
    messages: buildMessages(request),
    stream,
  }

  if (request.temperature !== undefined) payload.temperature = request.temperature
  if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens
  if (request.reasoningEffort !== undefined) payload.reasoning_effort = request.reasoningEffort
  if (request.verbosity !== undefined) payload.verbosity = request.verbosity
  if (request.responseFormat) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: request.responseFormat.name || 'response_schema',
        schema: request.responseFormat.schema,
        strict: request.responseFormat.strict !== false,
      },
    }
  }

  return payload
}

async function requestCompletion(request: ProviderRequest, stream: boolean) {
  const response = await proxyCopilotCompletionRequest({
    body: buildPayload(request, stream),
    signal: request.abortSignal,
    headers: request.userId ? { 'x-copilot-user-id': request.userId } : undefined,
  })

  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Hosted completion failed`)
  }

  return response
}

function createHostedStream(response: Response): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Hosted completion stream is empty')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const segments = buffer.split('\n\n')
        buffer = segments.pop() ?? ''

        for (const segment of segments) {
          for (const line of segment.split('\n')) {
            const data = line.startsWith('data:') ? line.slice(5).trim() : ''
            if (!data || data === '[DONE]') continue
            const payload = JSON.parse(data)
            const error = readCompletionError(payload)
            if (error) throw new Error(error)
            const content = readCompletionDeltaText(payload)
            if (content) controller.enqueue(new TextEncoder().encode(content))
          }
        }
      }

      controller.close()
    },
  })
}

export const hostedProvider: ProviderConfig = {
  id: 'hosted',
  name: 'Hosted',
  description: 'Platform-managed models via TradingGoose Copilot',
  version: '1.0.0',
  models: getProviderModels('hosted'),
  defaultModel: getProviderDefaultModel('hosted'),

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse | ReadableStream> => {
    if (request.stream) {
      return createHostedStream(await requestCompletion(request, true))
    }

    const data = await (await requestCompletion(request, false)).json()
    const error = readCompletionError(data)
    if (error) throw new Error(error)

    return {
      content: readCompletionMessageText(data),
      model: request.model,
      tokens: readUsage(data),
    }
  },
}
