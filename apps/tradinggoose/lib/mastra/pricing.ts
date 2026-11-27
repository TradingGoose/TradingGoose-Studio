import type { LanguageModelUsage } from '@mastra/core/stream'
import { providers } from '@opencode-ai/models/snapshot'
import { getCacheTokenUsage, type NativeCost } from './usage'

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
  if (separator < 1) return { status: 'unavailable' }
  const listed = providers[provider]?.models[model.slice(separator + 1)]
  const pricing = listed?.cost
  if (!pricing) return { status: 'unavailable' }
  const googleUsage = (
    providerMetadata?.google as
      | {
          usageMetadata?: {
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
  const rawUsage = usage.raw as
    | {
        inputTokens?: unknown
        raw?: {
          prompt_tokens_details?: { audio_tokens?: number }
          completion_tokens_details?: { audio_tokens?: number }
        }
      }
    | undefined
  const inputAudio =
    rawUsage?.raw?.prompt_tokens_details?.audio_tokens ??
    audioTokens(googleUsage?.promptTokensDetails)
  const outputAudio =
    rawUsage?.raw?.completion_tokens_details?.audio_tokens ??
    audioTokens(googleUsage?.candidatesTokensDetails)
  const { cachedInputTokens: read = 0, cacheCreationInputTokens: write = 0 } = getCacheTokenUsage(
    usage,
    providerMetadata
  )
  const write5m = usage.cacheCreationInputTokens5m ?? 0
  const write1h = usage.cacheCreationInputTokens1h ?? 0
  const reasoning = usage.reasoningTokens ?? googleUsage?.thoughtsTokenCount ?? 0
  // Match Mastra's native usage semantics: V2 Anthropic prompt counts exclude cache tokens;
  // normalized top-level cache counts and V3 raw totals already include them.
  const inputTokens =
    usage.inputTokens === undefined
      ? undefined
      : usage.inputTokens +
        (providerMetadata?.anthropic &&
        !(usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0) &&
        !(usage.cacheCreationInputTokens !== undefined && usage.cacheCreationInputTokens > 0) &&
        typeof rawUsage?.inputTokens !== 'object'
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
    priced(write - write1h, rates.cache_write),
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
  }
}
