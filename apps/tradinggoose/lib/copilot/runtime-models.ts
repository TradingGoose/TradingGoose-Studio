import type { ProviderId } from '@/providers/ai/types'

export type CopilotRuntimeProviderId = Extract<ProviderId, 'openai' | 'anthropic'>

export const COPILOT_RUNTIME_MODEL_CONFIGS = [
  { model: 'gpt-5.4', provider: 'openai' },
  { model: 'gpt-5.4-mini', provider: 'openai' },
  { model: 'claude-opus-4.6', provider: 'anthropic' },
  { model: 'claude-sonnet-4.6', provider: 'anthropic' },
] as const satisfies readonly { model: string; provider: CopilotRuntimeProviderId }[]

export type CopilotRuntimeModel = (typeof COPILOT_RUNTIME_MODEL_CONFIGS)[number]['model']

export const COPILOT_RUNTIME_MODELS = COPILOT_RUNTIME_MODEL_CONFIGS.map(({ model }) => model) as [
  CopilotRuntimeModel,
  ...CopilotRuntimeModel[],
]

export function getCopilotRuntimeModelProvider(
  model: string
): CopilotRuntimeProviderId | undefined {
  return COPILOT_RUNTIME_MODEL_CONFIGS.find((config) => config.model === model.trim())?.provider
}

export const DEFAULT_COPILOT_RUNTIME_MODEL: CopilotRuntimeModel = 'claude-sonnet-4.6'

export const COPILOT_RUNTIME_MODEL_OPTIONS: ReadonlyArray<{
  value: CopilotRuntimeModel
  label: CopilotRuntimeModel
}> = COPILOT_RUNTIME_MODELS.map((model) => ({
  value: model,
  label: model,
}))
