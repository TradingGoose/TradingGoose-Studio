import type { LanguageModelUsage } from '@mastra/core/stream'
import { providers } from '@opencode-ai/models/snapshot'
import { getConfiguredProviders } from './connections'

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
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0)
        usage[key] = (usage[key] ?? 0) + count
    }
  }
  return usage
}

const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Price observed usage from the pinned models.dev snapshot for reporting and account accrual. */
export async function calculateNativeCost(
  model: string,
  usage: Partial<LanguageModelUsage>,
  providerMetadata?: Record<string, unknown>
): Promise<NativeCost> {
  const separator = model.indexOf('/')
  const provider = model.slice(0, separator)
  // A custom endpoint cannot inherit another provider's published prices.
  if (separator < 1 || getConfiguredProviders()[provider]) return { status: 'unavailable' }
  const listed = providers[provider]?.models[model.slice(separator + 1)]
  const pricing = listed?.cost
  if (!pricing) return { status: 'unavailable' }
  const anthropic = providerMetadata?.anthropic as
    | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
    | undefined
  const googleUsage = (
    providerMetadata?.google as
      | {
          usageMetadata?: {
            cachedContentTokenCount?: number
            thoughtsTokenCount?: number
            promptTokensDetails?: Array<{ modality: string; tokenCount: number }>
            candidatesTokensDetails?: Array<{ modality: string; tokenCount: number }>
          }
        }
      | undefined
  )?.usageMetadata
  const audioTokens = (details?: Array<{ modality: string; tokenCount: number }>) =>
    (details ?? [])
      .filter((entry) => entry.modality === 'AUDIO')
      .reduce((sum, entry) => (amount(entry.tokenCount) ? sum + entry.tokenCount : Number.NaN), 0)
  const inputAudio = audioTokens(googleUsage?.promptTokensDetails)
  const outputAudio = audioTokens(googleUsage?.candidatesTokensDetails)
  const read =
    usage.cachedInputTokens ??
    anthropic?.cacheReadInputTokens ??
    googleUsage?.cachedContentTokenCount ??
    0
  const write5m = usage.cacheCreationInputTokens5m ?? 0
  const write1h = usage.cacheCreationInputTokens1h ?? 0
  const write =
    usage.cacheCreationInputTokens ?? anthropic?.cacheCreationInputTokens ?? write5m + write1h
  const reasoning = usage.reasoningTokens ?? googleUsage?.thoughtsTokenCount ?? 0
  // Match Mastra's native usage semantics: V2 Anthropic prompt counts exclude cache tokens;
  // normalized top-level cache counts and V3 raw totals already include them.
  const rawInput = (usage.raw as { inputTokens?: unknown } | undefined)?.inputTokens
  const inputTokens =
    usage.inputTokens === undefined
      ? undefined
      : usage.inputTokens +
        (anthropic &&
        !(usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0) &&
        !(usage.cacheCreationInputTokens !== undefined && usage.cacheCreationInputTokens > 0) &&
        typeof rawInput !== 'object'
          ? read + write
          : 0)
  const rates =
    pricing.tiers
      ?.filter((entry) => amount(inputTokens) && inputTokens > entry.tier.size)
      .sort((a, b) => b.tier.size - a.tier.size)[0] ?? pricing
  if (
    ![read, write, write5m, write1h, reasoning, inputAudio, outputAudio].every(amount) ||
    write < write5m + write1h
  )
    return { status: 'unavailable' }
  // The native price format has no separate cached-audio tariff. Do not guess one.
  if (inputAudio > 0 && read > 0) return { status: 'unavailable' }
  const priced = (tokens: number | undefined, rate: number | undefined) =>
    tokens === 0 ? 0 : amount(tokens) && amount(rate) ? (tokens * rate) / 1_000_000 : undefined
  const inputParts = [
    priced(
      inputTokens === undefined ? undefined : inputTokens - read - write - inputAudio,
      rates.input
    ),
    priced(read, rates.cache_read),
    priced(write - write5m - write1h, rates.cache_write),
    priced(write5m, rates.cache_write),
    priced(inputAudio, rates.input_audio),
    // models.dev publishes Claude's five-minute write rate; Mastra uses 1.6x for one hour.
    priced(
      write1h,
      (provider === 'anthropic' || listed.canonical_model_id?.startsWith('anthropic/claude')) &&
        rates.cache_write !== undefined
        ? rates.cache_write * 1.6
        : undefined
    ),
  ]
  const outputParts = [
    priced(
      listed?.type === 'embedding'
        ? 0
        : usage.outputTokens === undefined
          ? undefined
          : usage.outputTokens - reasoning - outputAudio,
      rates.output
    ),
    priced(reasoning, rates.reasoning ?? rates.output),
    priced(outputAudio, rates.output_audio),
  ]
  const input = inputParts.every(amount)
    ? inputParts.reduce((sum, part) => sum + part, 0)
    : undefined
  const output = outputParts.every(amount)
    ? outputParts.reduce((sum, part) => sum + part, 0)
    : undefined
  if (input === undefined || output === undefined || !amount(input + output))
    return { status: 'unavailable' }
  return {
    input,
    output,
    total: input + output,
    currency: 'USD',
    estimated: true,
    status: 'estimated',
  }
}

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
