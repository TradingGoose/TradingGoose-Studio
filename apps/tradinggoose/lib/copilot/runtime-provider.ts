import type { ProviderId } from '@/providers/ai/types'

export const COPILOT_RUNTIME_PROVIDER_IDS = ['openai', 'anthropic'] as const satisfies readonly ProviderId[]

export function deriveCopilotProviderFromModel(model: string): ProviderId {
  const normalized = model.trim().toLowerCase()

  if (normalized.startsWith('gpt-')) {
    return 'openai'
  }

  return 'anthropic'
}

export function resolveCopilotRuntimeProvider(
  model: string,
  requestedProvider?: ProviderId
): ProviderId {
  const derivedProvider = deriveCopilotProviderFromModel(model)

  if (!requestedProvider) {
    return derivedProvider
  }

  return requestedProvider === derivedProvider ? requestedProvider : derivedProvider
}
