export const LOCAL_COPILOT_MODEL_PREFIX = 'vllm/'

/**
 * Locally-hosted models that the Copilot widget can talk to directly, with
 * full agentic (server tool-calling) support. These are the same self-hosted
 * vLLM/SGLang models configured in Studio's AI providers.
 *
 * The widget's model list is built dynamically at runtime by fetching
 * `/api/providers/ai/vllm/models` (the vLLM provider's model discovery route)
 * and exposing any model whose id starts with the `vllm/` prefix.
 */
export async function getCopilotLocalRuntimeModels(): Promise<string[]> {
  try {
    const res = await fetch('/api/providers/ai/vllm/models', { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: unknown }
    if (!Array.isArray(data.models)) return []
    return data.models
      .filter((m): m is string => typeof m === 'string' && m.startsWith(LOCAL_COPILOT_MODEL_PREFIX))
      .sort()
  } catch {
    return []
  }
}

export function isCopilotLocalRuntimeModel(model: string): boolean {
  return typeof model === 'string' && model.startsWith(LOCAL_COPILOT_MODEL_PREFIX)
}
