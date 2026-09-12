import {
  isCopilotLocalRuntimeModel,
  LOCAL_COPILOT_MODEL_PREFIX,
} from '@/lib/copilot/local-runtime/runtime-models'

export { isCopilotLocalRuntimeModel, LOCAL_COPILOT_MODEL_PREFIX }

export const COPILOT_RUNTIME_MODELS = [
  'deepseek/deepseek-v4-pro',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-sol',
  'anthropic/claude-fable-5',
  'anthropic/claude-opus-5',
  'x-ai/grok-4.6',
] as const

export type HostedCopilotRuntimeModel = (typeof COPILOT_RUNTIME_MODELS)[number]

/**
 * Hosted models plus any self-hosted `vllm/` model. Local ids are validated by
 * prefix rather than enum membership, so a newly deployed vLLM model works
 * without an app rebuild. The `& {}` keeps autocomplete for hosted ids.
 */
export type CopilotRuntimeModel = HostedCopilotRuntimeModel | (string & {})

export const HOSTED_COPILOT_RUNTIME_MODEL_SET: ReadonlySet<string> = new Set(
  COPILOT_RUNTIME_MODELS
)

export const DEFAULT_COPILOT_RUNTIME_MODEL: CopilotRuntimeModel =
  'anthropic/claude-fable-5'

export function isValidCopilotRuntimeModel(model: unknown): model is string {
  return (
    typeof model === 'string' &&
    (HOSTED_COPILOT_RUNTIME_MODEL_SET.has(model) || isCopilotLocalRuntimeModel(model))
  )
}
