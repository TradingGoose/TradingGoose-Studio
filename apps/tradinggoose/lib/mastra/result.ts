import type { ProviderTiming } from '@/lib/logs/types'
import type { NativeCost } from './usage'

export interface InferenceFacts {
  history?: { threadId: string; resourceId: string; runId: string }
  model?: string
  tokens?: { prompt?: number; completion?: number; total?: number }
  cost?: NativeCost
  embeddingUsage?: { status: 'reported' | 'partial' | 'unavailable'; batches: number }
  toolCost?: number
  unavailableToolCosts?: number
  toolResults?: unknown[]
  toolCalls?: { list: Array<Record<string, any>>; count: number }
  providerTiming?: ProviderTiming
  generatedFields: string[]
}

const INFERENCE_RESULT = Symbol('trusted-inference-result')

export function withInferenceFacts<T extends Record<string, any>>(
  output: T,
  facts: InferenceFacts
): T {
  // Enumerable Symbols survive Object.assign during stream completion but never JSON serialization.
  Object.defineProperty(output, INFERENCE_RESULT, { value: facts, enumerable: true })
  return output
}

export function getInferenceFacts(output: unknown): InferenceFacts | undefined {
  return output && typeof output === 'object' && Object.hasOwn(output, INFERENCE_RESULT)
    ? (output as Record<symbol, InferenceFacts>)[INFERENCE_RESULT]
    : undefined
}

export function isInferenceResult(output: unknown): boolean {
  return getInferenceFacts(output) !== undefined
}

/** Inspect the public native result, never schema-owned error/control fields. */
export function assertNativeCompletion(result: {
  error?: unknown
  tripwire?: unknown
  finishReason?: string
  usedFallbackValue?: boolean
}) {
  if (
    result.error ||
    result.tripwire ||
    result.usedFallbackValue ||
    !['stop', 'tool-calls', 'length'].includes(result.finishReason ?? '')
  )
    throw new Error(
      `Native generation did not complete successfully (${result.finishReason ?? 'unknown'})`
    )
}
