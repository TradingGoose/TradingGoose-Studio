export const COPILOT_RUNTIME_MODELS = [
  'deepseek/deepseek-v4-pro',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-sol',
  'anthropic/claude-fable-5',
  'anthropic/claude-opus-5',
  'x-ai/grok-4.6',
] as const

export type CopilotRuntimeModel = (typeof COPILOT_RUNTIME_MODELS)[number]

export const DEFAULT_COPILOT_RUNTIME_MODEL: CopilotRuntimeModel = 'anthropic/claude-fable-5'
