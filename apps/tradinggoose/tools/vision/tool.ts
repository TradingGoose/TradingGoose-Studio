import { withInferenceFacts } from '@/lib/mastra/result'
import type { ToolConfig } from '@/tools/types'
import type { VisionParams, VisionResponse } from '@/tools/vision/types'

export const visionTool: ToolConfig<VisionParams, VisionResponse> = {
  id: 'vision_tool',
  name: 'Vision Tool',
  description:
    'Process and analyze images using advanced vision models. Capable of understanding image content, extracting text, identifying objects, and providing detailed visual descriptions.',
  version: '1.0.0',
  settlesModelUsage: true,

  params: {
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for the selected model provider',
    },
    imageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Publicly accessible image URL',
    },
    imageFile: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Image file to analyze',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Listed Mastra provider/model ID to use for image analysis',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom prompt for image analysis',
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/vision/analyze',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        apiKey: params.apiKey,
        imageUrl: params.imageUrl || null,
        imageFile: params.imageFile || null,
        model: params.model || 'openai/gpt-4o',
        prompt: params.prompt || null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: withInferenceFacts(data.output, {
        model: data.output.model,
        tokens: data.output.tokens,
        cost: data.output.cost,
        generatedFields: ['model', 'tokens', 'cost'],
      }),
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The analyzed content and description of the image',
    },
    model: {
      type: 'string',
      description: 'The vision model that was used for analysis',
      optional: true,
    },
    tokens: {
      type: 'object',
      description: 'Reported prompt, completion and total tokens',
      optional: true,
    },
    cost: {
      type: 'object',
      description: 'Reported or estimated model cost in USD, with availability status',
      optional: true,
    },
  },
}
