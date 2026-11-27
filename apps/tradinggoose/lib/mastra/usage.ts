import type { LanguageModelUsage } from '@mastra/core/stream'

const tokenFields = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
] as const

export type NativeUsage = Partial<Pick<LanguageModelUsage, (typeof tokenFields)[number]>> & {
  cacheStatus?: 'hit' | 'miss'
}

/** Use the same reported cache quantities for message history and pricing. */
export function getCacheTokenUsage(
  usage: Partial<LanguageModelUsage>,
  providerMetadata?: Record<string, unknown>
) {
  const anthropic = providerMetadata?.anthropic as
    | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
    | undefined
  const google = providerMetadata?.google as
    | { usageMetadata?: { cachedContentTokenCount?: number } }
    | undefined
  const { cacheCreationInputTokens5m, cacheCreationInputTokens1h } = usage
  return {
    cachedInputTokens:
      usage.cachedInputTokens ??
      anthropic?.cacheReadInputTokens ??
      google?.usageMetadata?.cachedContentTokenCount,
    cacheCreationInputTokens:
      usage.cacheCreationInputTokens ??
      anthropic?.cacheCreationInputTokens ??
      (cacheCreationInputTokens5m !== undefined || cacheCreationInputTokens1h !== undefined
        ? (cacheCreationInputTokens5m ?? 0) + (cacheCreationInputTokens1h ?? 0)
        : undefined),
  }
}

export interface NativeCost {
  input?: number
  output?: number
  total?: number
  availableTotal?: number
  currency?: string
  status?: 'reported' | 'unavailable' | 'partial'
  /** BYOK is report-only; aggregates retain only their account-funded subtotal here. */
  accountCost?: Omit<NativeCost, 'accountCost'> | null
}

export function sumNativeUsage(steps: Array<{ usage?: NativeUsage }>): NativeUsage {
  const usage: NativeUsage = {}
  for (const step of steps) {
    for (const key of tokenFields) {
      const count = step.usage?.[key]
      if (amount(count)) usage[key] = (usage[key] ?? 0) + count
    }
  }
  return usage
}

const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function sumCostAmounts(costs: NativeCost[]): NativeCost {
  if (!costs.length) return { status: 'unavailable' }
  if (costs.some((cost) => cost.currency !== undefined && cost.currency !== 'USD'))
    return { status: 'unavailable' }
  const complete = costs.filter(
    (cost) => cost.status !== 'partial' && cost.status !== 'unavailable' && amount(cost.total)
  )
  const total = complete.reduce((sum, cost) => sum + cost.total!, 0)
  if (complete.length !== costs.length) {
    const partial = costs.filter((cost) => cost.status === 'partial' && amount(cost.availableTotal))
    return complete.length || partial.length
      ? {
          status: 'partial',
          currency: 'USD',
          availableTotal: total + partial.reduce((sum, cost) => sum + cost.availableTotal!, 0),
        }
      : { status: 'unavailable' }
  }
  return {
    total,
    currency: 'USD',
    ...(costs.every((cost) => amount(cost.input))
      ? { input: costs.reduce((sum, cost) => sum + cost.input!, 0) }
      : {}),
    ...(costs.every((cost) => amount(cost.output))
      ? { output: costs.reduce((sum, cost) => sum + cost.output!, 0) }
      : {}),
  }
}

/** Preserve catalog costs and their account-funded subtotal using the same arithmetic. */
export function sumNativeCosts(costs: NativeCost[]): NativeCost {
  const cost = sumCostAmounts(costs)
  if (costs.some((component) => component.accountCost !== undefined)) {
    cost.accountCost = sumCostAmounts(
      costs.map((component) =>
        component.accountCost === null
          ? { input: 0, output: 0, total: 0, currency: 'USD' }
          : (component.accountCost ?? component)
      )
    )
  }
  return cost
}

export function resultAccounting(
  usage: NativeUsage = {},
  cost: NativeCost = { status: 'unavailable' }
) {
  const tokens: { prompt?: number; completion?: number; total?: number } = {}
  for (const [source, target] of [
    ['inputTokens', 'prompt'],
    ['outputTokens', 'completion'],
    ['totalTokens', 'total'],
  ] as const) {
    const count = usage[source]
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) tokens[target] = count
  }
  return { tokens, cost }
}
