import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { resolveCopilotApiServiceConfig } from '@/lib/system-services/runtime'
import type { ProviderId } from '@/providers/ai/types'
import { resolveCopilotRuntimeProvider } from '@/lib/copilot/runtime-provider'

export async function buildCopilotRuntimeProviderConfig(params: {
  model: string
  provider?: ProviderId
}): Promise<{
  provider: ProviderId
  providerConfig: CopilotProviderConfig
}> {
  const provider = resolveCopilotRuntimeProvider(params.model, params.provider)
  const copilotApi = await resolveCopilotApiServiceConfig()

  return {
    provider,
    providerConfig: {
      provider,
      model: params.model,
      apiKey: copilotApi.apiKey ?? undefined,
    },
  }
}
