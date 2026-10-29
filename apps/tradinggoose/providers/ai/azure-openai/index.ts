import OpenAI from 'openai'
import { resolveAzureOpenAIServiceConfig } from '@/lib/system-services/runtime'
import { executeResponsesRequest } from '@/providers/ai/openai'
import type { ProviderConfig } from '@/providers/ai/types'

export const azureOpenAIProvider: ProviderConfig = {
  id: 'azure-openai',
  executeRequest: async (request) => {
    const config = await resolveAzureOpenAIServiceConfig()
    const endpoint = request.azureEndpoint || config.endpoint
    if (!endpoint) {
      throw new Error(
        'Azure OpenAI endpoint is required. Please provide it via azureEndpoint parameter or admin services.'
      )
    }
    const client = new OpenAI({
      apiKey: request.apiKey || config.apiKey || '',
      baseURL: `${endpoint.replace(/\/$/, '')}/openai/v1`,
    })
    return executeResponsesRequest(request, client, request.model.replace(/^azure\//, ''))
  },
}
