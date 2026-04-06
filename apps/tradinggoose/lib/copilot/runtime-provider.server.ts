import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { env } from '@/lib/env'
import type { ProviderId } from '@/providers/ai/types'
import { resolveCopilotRuntimeProvider } from '@/lib/copilot/runtime-provider'

export function buildCopilotRuntimeProviderConfig(params: {
  model: string
  provider?: ProviderId
}): {
  provider: ProviderId
  providerConfig: CopilotProviderConfig
} {
  const provider = resolveCopilotRuntimeProvider(params.model, params.provider)

  return {
    provider,
    providerConfig: {
      provider,
      model: params.model,
      apiKey: env.COPILOT_API_KEY,
    },
  }
}
