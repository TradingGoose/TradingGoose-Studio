import { getCopilotRuntimeModelProvider } from '@/lib/copilot/runtime-models'
import type { ProviderId } from '@/providers/ai/types'

export const COPILOT_RUNTIME_PROVIDER_IDS = [
  'openai',
  'anthropic',
] as const satisfies readonly ProviderId[]

function getCopilotRuntimeProviderForModel(model: string): ProviderId {
  const provider = getCopilotRuntimeModelProvider(model)
  if (!provider) {
    throw new Error(`No Copilot runtime provider configured for model: ${model}`)
  }

  return provider
}

export function resolveCopilotRuntimeProvider(
  model: string,
  requestedProvider?: ProviderId
): ProviderId {
  const configuredProvider = getCopilotRuntimeProviderForModel(model)

  if (!requestedProvider) {
    return configuredProvider
  }

  if (requestedProvider !== configuredProvider) {
    throw new Error(
      `Copilot runtime model ${model} is configured for ${configuredProvider}, not ${requestedProvider}`
    )
  }

  return configuredProvider
}
