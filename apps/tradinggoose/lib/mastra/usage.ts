/** Active public result facts only. Ordinary native history is not a token or price report. */
export interface NativeUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface NativeCost {
  input?: number
  output?: number
  total?: number
  estimated?: boolean
  availableTotal?: number
  currency?: string
  status: 'reported' | 'estimated' | 'unavailable' | 'partial'
}

export function sumNativeUsage(
  steps: Array<{ usage?: NativeUsage; finishReason?: string; response?: { id?: string } }>
): NativeUsage {
  const usage: NativeUsage = {}
  for (const step of steps) {
    if (step.finishReason === 'error' && step.response?.id === '') continue
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const count = step.usage?.[key]
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0)
        usage[key] = (usage[key] ?? 0) + count
    }
  }
  return usage
}

/** Choose one representation; cumulative totals and per-step observations overlap. */
export function selectNativeUsage(...candidates: Array<NativeUsage | undefined>): NativeUsage {
  for (const candidate of candidates) {
    const known = sumNativeUsage([{ usage: candidate }])
    if (Object.keys(known).length) return known
  }
  return {}
}

export function resultAccounting(usage: NativeUsage = {}) {
  const tokens: { prompt?: number; completion?: number; total?: number } = {}
  for (const [source, target] of [
    ['inputTokens', 'prompt'],
    ['outputTokens', 'completion'],
    ['totalTokens', 'total'],
  ] as const) {
    const count = usage[source]
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) tokens[target] = count
  }
  return { tokens, cost: { status: 'unavailable' } as NativeCost }
}
