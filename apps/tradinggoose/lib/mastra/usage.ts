/** Reported token fields; missing counts stay unknown in logs and native message metadata. */
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
  /** BYOK is report-only; aggregates retain only their account-funded subtotal here. */
  accountCost?: Omit<NativeCost, 'accountCost'> | null
}

export function sumNativeUsage(steps: Array<{ usage?: NativeUsage }>): NativeUsage {
  const usage: NativeUsage = {}
  for (const step of steps) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const count = step.usage?.[key]
      if (amount(count)) usage[key] = (usage[key] ?? 0) + count
    }
  }
  return usage
}

const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function sumCostAmounts(costs: NativeCost[]): NativeCost {
  if (!costs.length) return { status: 'unavailable' }
  if (costs.some((cost) => cost.currency !== undefined && cost.currency !== 'USD'))
    return { status: 'unavailable' }
  const complete = costs.filter(
    (cost) => ['reported', 'estimated'].includes(cost.status) && amount(cost.total)
  )
  const estimated = costs.some((cost) => cost.estimated || cost.status === 'estimated')
  const total = complete.reduce((sum, cost) => sum + cost.total!, 0)
  if (complete.length !== costs.length) {
    const partial = costs.filter((cost) => cost.status === 'partial' && amount(cost.availableTotal))
    return complete.length || partial.length
      ? {
          status: 'partial',
          currency: 'USD',
          estimated,
          availableTotal: total + partial.reduce((sum, cost) => sum + cost.availableTotal!, 0),
        }
      : { status: 'unavailable' }
  }
  return {
    total,
    currency: 'USD',
    estimated,
    status: estimated ? 'estimated' : 'reported',
    ...(costs.every((cost) => amount(cost.input))
      ? { input: costs.reduce((sum, cost) => sum + cost.input!, 0) }
      : {}),
    ...(costs.every((cost) => amount(cost.output))
      ? { output: costs.reduce((sum, cost) => sum + cost.output!, 0) }
      : {}),
  }
}

/** Preserve reference estimates and their account-funded subtotal using the same arithmetic. */
export function sumNativeCosts(costs: NativeCost[]): NativeCost {
  const cost = sumCostAmounts(costs)
  if (costs.some((component) => component.accountCost !== undefined)) {
    cost.accountCost = sumCostAmounts(
      costs.map((component) =>
        component.accountCost === null
          ? { input: 0, output: 0, total: 0, currency: 'USD', status: 'reported' }
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
