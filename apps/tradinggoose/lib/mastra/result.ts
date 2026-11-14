import type { FullOutput } from '@mastra/core/stream'
import type { NativeCost } from './usage'

export interface InferenceFacts {
  history?: { threadId: string; resourceId: string; runId: string }
  model?: string
  tokens?: { prompt?: number; completion?: number; total?: number }
  cost?: NativeCost
  embeddingUsage?: { status: 'reported' | 'partial' | 'unavailable'; batches: number }
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

/** A completed text answer belongs to the final native step, not the concatenated transcript. */
export function getNativeFinalText(result: {
  steps: Pick<FullOutput['steps'][number], 'text'>[]
}): string {
  const text = result.steps.at(-1)?.text
  if (!text?.trim()) throw new Error('Native generation did not produce a final answer')
  return text
}

/** Inspect the public native result, never schema-owned error/control fields. */
export function assertNativeCompletion(result: {
  error?: unknown
  tripwire?: unknown
  finishReason?: string
  usedFallbackValue?: boolean
}) {
  if (result.finishReason === 'tool-calls')
    throw new Error('Native generation reached its step limit before producing a final answer.')
  if (
    result.error ||
    result.tripwire ||
    result.usedFallbackValue ||
    !['stop', 'length'].includes(result.finishReason ?? '')
  )
    throw new Error(
      `Native generation did not complete successfully (${result.finishReason ?? 'unknown'})`
    )
}
