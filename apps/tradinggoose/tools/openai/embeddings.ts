import { withInferenceFacts } from '@/lib/mastra/result'
import type { OpenAIEmbeddingsParams } from '@/tools/openai/types'
import type { ToolConfig } from '@/tools/types'

export const embeddingsTool: ToolConfig<OpenAIEmbeddingsParams> = {
  id: 'openai_embeddings',
  name: 'OpenAI Embeddings',
  description: "Generate embeddings from text using OpenAI's embedding models",
  version: '1.0',
  settlesModelUsage: true,

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact text or an array of texts to generate embeddings for',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Listed native OpenAI embedding provider/model identifier',
      default: 'openai/text-embedding-3-small',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OpenAI API key',
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/openai/embeddings',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      input: params.input,
      model: params.model || 'openai/text-embedding-3-small',
      apiKey: params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.output) throw new Error(data.error || 'Embedding request failed')
    const { embeddings, model, tokens, cost, embeddingUsage } = data.output
    return {
      success: data.success === true,
      ...(data.success === false ? { error: data.error || 'Embedding request failed' } : {}),
      output: withInferenceFacts(
        { embeddings, model, tokens, cost, embeddingUsage },
        {
          model,
          tokens,
          cost,
          generatedFields: ['model', 'tokens', 'cost', 'embeddingUsage'],
        }
      ),
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Embeddings generation results',
      properties: {
        embeddings: { type: 'array', description: 'Array of embedding vectors' },
        model: { type: 'string', description: 'Model used for generating embeddings' },
        tokens: { type: 'object', description: 'Available native token counts' },
        cost: {
          type: 'object',
          description: 'Reported or estimated model cost in USD, with availability status',
        },
        embeddingUsage: {
          type: 'object',
          description: 'Completed batch count and reported usage status',
        },
      },
    },
  },
}
