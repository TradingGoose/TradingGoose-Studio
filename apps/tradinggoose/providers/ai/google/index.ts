import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/ai/gemini/core'
import { getProviderDefaultModel, getProviderModels } from '@/providers/ai/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/ai/types'

const logger = createLogger('GoogleProvider')
const DEFAULT_MODEL = getProviderDefaultModel('google')

/**
 * Google Gemini provider
 *
 * Uses the @google/genai SDK with API key authentication.
 * Shares core execution logic with Vertex AI provider.
 */
export const googleProvider: ProviderConfig = {
  id: 'google',
  name: 'Google',
  description: "Google's Gemini models",
  version: '1.0.0',
  models: getProviderModels('google'),
  defaultModel: DEFAULT_MODEL,

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Google Gemini')
    }

    const model = request.model || DEFAULT_MODEL
    logger.info('Creating Google Gemini client', { model })

    const ai = new GoogleGenAI({ apiKey: request.apiKey })

    return executeGeminiRequest({
      ai,
      model,
      request,
      providerType: 'google',
    })
  },
}
