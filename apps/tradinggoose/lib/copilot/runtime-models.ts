export const COPILOT_RUNTIME_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'claude-opus-4.6',
  'claude-sonnet-4.6',
] as const

export type CopilotRuntimeModel = (typeof COPILOT_RUNTIME_MODELS)[number]

export const DEFAULT_COPILOT_RUNTIME_MODEL: CopilotRuntimeModel = 'claude-sonnet-4.6'

export const COPILOT_RUNTIME_MODEL_OPTIONS: ReadonlyArray<{
  value: CopilotRuntimeModel
  label: CopilotRuntimeModel
}> = COPILOT_RUNTIME_MODELS.map((model) => ({
  value: model,
  label: model,
}))
