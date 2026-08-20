import { checkForForcedToolUsageOpenAI } from '@/providers/ai/utils'

const FIREWORKS_WIRE_NAMES: Record<string, string> = {
  'glm-5.2': 'accounts/fireworks/models/glm-5p2',
  'kimi-k3': 'accounts/fireworks/models/kimi-k3',
}

const FIREWORKS_CATALOG_NAMES = Object.fromEntries(
  Object.entries(FIREWORKS_WIRE_NAMES).map(([catalogName, wireName]) => [wireName, catalogName])
)

export function resolveFireworksWireModel(model: string): string {
  return FIREWORKS_WIRE_NAMES[model] ?? model
}

export function normalizeFireworksCatalogModel(model: string): string {
  return FIREWORKS_CATALOG_NAMES[model] ?? model
}

/**
 * Checks if a model supports native structured outputs (json_schema).
 * Fireworks AI supports structured outputs across their inference API.
 */
export async function supportsNativeStructuredOutputs(_modelId: string): Promise<boolean> {
  return true
}

/**
 * Checks if a forced tool was used in a Fireworks response.
 * Uses the shared OpenAI-compatible forced tool usage helper.
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  return checkForForcedToolUsageOpenAI(
    response,
    toolChoice,
    'Fireworks',
    forcedTools,
    usedForcedTools
  )
}
