import { createLogger } from '@/lib/logs/console/logger'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { withInferenceFacts } from '@/lib/mastra/result'
import type { NativeCost } from '@/lib/mastra/usage'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('LLMChatTool')

interface LLMChatParams {
  model: string
  systemPrompt?: string
  context: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

interface LLMChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    cost?: NativeCost
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
  }
}

export const llmChatTool: ToolConfig<LLMChatParams, LLMChatResponse> = {
  id: 'llm_chat',
  name: 'LLM Chat',
  description: 'Send a chat completion request to any supported LLM provider',
  version: '1.0.0',
  settlesModelUsage: true,

  params: {
    model: {
      type: 'string',
      required: true,
      description: 'A listed Mastra provider/model identifier',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      description: 'System prompt to set the behavior of the assistant',
    },
    context: {
      type: 'string',
      required: true,
      description: 'The user message or context to send to the model',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Request-local API key; otherwise uses the configured Mastra connection',
    },
    temperature: {
      type: 'number',
      required: false,
      description: 'Temperature for response generation, where supported by the selected model',
    },
    maxTokens: {
      type: 'number',
      required: false,
      description: 'Maximum tokens in the response',
    },
  },

  request: {
    url: () => '/api/providers',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        providerNamespace: 'ai',
        model: params.model,
        instructions: params.systemPrompt,
        messages: [{ role: 'user', content: params.context }],
        apiKey: params.apiKey,
        modelSettings: { temperature: params.temperature, maxOutputTokens: params.maxTokens },
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error || `LLM API error: ${response.status}`
      logger.error('LLM chat request failed', { error: errorMessage })
      throw Object.assign(new Error(errorMessage), getFailureAccounting(errorData))
    }

    const data = await response.json()

    return {
      success: true,
      output: withInferenceFacts(
        {
          content: data.content,
          model: data.model,
          tokens: data.tokens,
          cost: data.cost,
        },
        {
          model: data.model,
          tokens: data.tokens,
          cost: data.cost,
          generatedFields: ['model', 'tokens', 'cost'],
        }
      ),
    }
  },

  outputs: {
    content: { type: 'string', description: 'The generated response content' },
    model: { type: 'string', description: 'The model used for generation' },
    tokens: { type: 'object', description: 'Available native token usage' },
    cost: {
      type: 'object',
      description: 'Reported or estimated model cost in USD, with availability status',
    },
  },
}
