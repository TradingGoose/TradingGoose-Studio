import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@/lib/logs/console/logger'
import { executeAnthropicProviderRequest } from '@/providers/ai/anthropic/core'
import type { ProviderConfig } from '@/providers/ai/types'

const logger = createLogger('AnthropicProvider')

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',

  executeRequest: (request) =>
    executeAnthropicProviderRequest(request, {
      providerLabel: 'Anthropic',
      createClient: (apiKey, useNativeStructuredOutputs) =>
        new Anthropic({
          apiKey,
          ...(useNativeStructuredOutputs && {
            defaultHeaders: { 'anthropic-beta': 'structured-outputs-2025-11-13' },
          }),
        }),
      logger,
    }),
}
