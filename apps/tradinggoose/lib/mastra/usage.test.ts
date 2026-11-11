import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateNativeCost, resultAccounting, sumNativeCosts, sumNativeUsage } from './usage'

const catalogue = vi.hoisted(() => ({ pricing: vi.fn() }))
vi.mock('@opencode-ai/models/snapshot', () => {
  const model = {
    get cost() {
      return catalogue.pricing()
    },
  }
  return {
    providers: {
      native: { models: { model } },
      openai: {
        models: {
          model,
          embedding: {
            type: 'embedding',
            get cost() {
              return catalogue.pricing()
            },
          },
        },
      },
      openrouter: { models: { model } },
      anthropic: { models: { 'claude-model': model } },
      google: { models: { 'gemini-2.5-flash': model } },
    },
  }
})
beforeEach(() => {
  catalogue.pricing
    .mockReset()
    .mockReturnValue({ input: 2, output: 8, cache_read: 0.2, cache_write: 2.5 })
})
afterEach(() => vi.unstubAllEnvs())

describe('public active result facts', () => {
  it('keeps reported zero, missing counts, and native total independently without inferring dollars', () => {
    expect(resultAccounting({ inputTokens: 0, totalTokens: 7 })).toEqual({
      tokens: { prompt: 0, total: 7 },
      cost: { status: 'unavailable' },
    })
    expect(resultAccounting()).toEqual({ tokens: {}, cost: { status: 'unavailable' } })
  })
  it('sums disjoint observed steps without inventing missing counts', () => {
    expect(
      sumNativeUsage([
        { usage: { inputTokens: 2, totalTokens: 5 } },
        { usage: { inputTokens: 0, totalTokens: 3 } },
      ])
    ).toEqual({ inputTokens: 2, totalTokens: 8 })
  })
  it('does not publish invalid or negative upstream counts', () => {
    expect(
      resultAccounting({
        inputTokens: Number.NaN,
        outputTokens: -1,
        totalTokens: Number.POSITIVE_INFINITY,
      }).tokens
    ).toEqual({})
  })
})

describe('native per-step USD pricing', () => {
  it('uses native Vercel Gateway USD ahead of published token prices', async () => {
    for (const reported of [0, 0.25, '0.25']) {
      expect(
        await calculateNativeCost(
          'vercel/openai/gpt-4o',
          {},
          {
            gateway: { cost: reported },
          }
        )
      ).toEqual({ total: Number(reported), currency: 'USD', status: 'reported' })
    }
    expect(catalogue.pricing).not.toHaveBeenCalled()
  })
  it('does not borrow published rates or billing metadata for an overridden endpoint', async () => {
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        openrouter: {
          name: 'Private endpoint',
          url: 'https://private.invalid/v1',
          models: ['model'],
          apiKeyEnvVar: [],
        },
      })
    )
    const cost = await calculateNativeCost(
      'openrouter/model',
      { inputTokens: 1000, outputTokens: 100 },
      { openrouter: { usage: { cost: 0 } } }
    )
    expect(cost).toEqual({ status: 'unavailable' })
    expect(catalogue.pricing).not.toHaveBeenCalled()
  })
  it('uses reported OpenRouter USD, including genuine zero, without consulting catalogue rates', async () => {
    for (const total of [0, 0.0123]) {
      expect(
        await calculateNativeCost(
          'openrouter/model',
          {},
          {
            openrouter: {
              usage: { cost: total, isByok: false, costDetails: { upstreamInferenceCost: 99 } },
            },
          }
        )
      ).toEqual({ total, currency: 'USD', status: 'reported' })
    }
    expect(catalogue.pricing).not.toHaveBeenCalled()
    await expect(
      calculateNativeCost('openrouter/model', {}, { openrouter: { usage: { cost: -1 } } })
    ).rejects.toThrow('Invalid provider-reported USD cost')
  })
  it('prices actual input and output tokens at USD per million, without charging cached input twice', async () => {
    const cost = await calculateNativeCost('openai/model', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cachedInputTokens: 800_000,
    })
    expect(cost).toMatchObject({ status: 'estimated', currency: 'USD', estimated: true })
    expect(cost.input).toBeCloseTo(0.56)
    expect(cost.output).toBeCloseTo(0.8)
    expect(cost.total).toBeCloseTo(1.36)
  })
  it('adds separately billed BYOK upstream USD and estimates ambiguous reports', async () => {
    expect(
      await calculateNativeCost(
        'openrouter/model',
        {},
        {
          openrouter: {
            usage: { cost: 0.01, isByok: true, costDetails: { upstreamInferenceCost: 0.125 } },
          },
        }
      )
    ).toMatchObject({ total: 0.135, status: 'reported' })
    expect(
      await calculateNativeCost(
        'openrouter/model',
        {},
        {
          openrouter: { usage: { cost: 0, costDetails: { upstreamInferenceCost: 0.125 } } },
        }
      )
    ).toMatchObject({ total: 0.125, status: 'reported' })
    expect(
      await calculateNativeCost(
        'openrouter/model',
        { inputTokens: 1000, outputTokens: 100 },
        {
          openrouter: { usage: { cost: 0.01, costDetails: { upstreamInferenceCost: 0.125 } } },
        }
      )
    ).toMatchObject({ total: 0.0028, status: 'estimated' })
  })
  it('uses the reached context tier and published reasoning rate', async () => {
    catalogue.pricing.mockReturnValue({
      input: 1,
      output: 2,
      tiers: [
        { tier: { size: 200_000 }, input: 3, output: 12, reasoning: 18 },
        { tier: { size: 500_000 }, input: 6, output: 24, reasoning: 36 },
      ],
    })
    const cost = await calculateNativeCost('native/model', {
      inputTokens: 250_000,
      outputTokens: 10_000,
      reasoningTokens: 2_000,
    })
    expect(cost.input).toBeCloseTo(0.75)
    expect(cost.output).toBeCloseTo(0.132)
    expect(cost.total).toBeCloseTo(0.882)
  })
  it('prices native Anthropic cache metadata without dropping or double-counting cached input', async () => {
    const metadata = { anthropic: { cacheReadInputTokens: 800, cacheCreationInputTokens: 100 } }
    const uncached = { inputTokens: 100, outputTokens: 100 }
    const normalized = {
      inputTokens: 1000,
      outputTokens: 100,
      cachedInputTokens: 800,
      cacheCreationInputTokens: 100,
    }
    const rawV3 = {
      inputTokens: 1000,
      outputTokens: 100,
      raw: { inputTokens: { total: 1000, cacheRead: 800, cacheWrite: 100 } },
    }
    for (const usage of [uncached, normalized, rawV3]) {
      const cost = await calculateNativeCost('anthropic/claude-model', usage, metadata)
      expect(cost.total).toBeCloseTo(0.00141)
    }
  })
  it('honors Google native cache and reasoning metadata when normalized details are absent', async () => {
    catalogue.pricing.mockReturnValue({ input: 2, output: 8, cache_read: 0.2, reasoning: 10 })
    const cost = await calculateNativeCost(
      'google/gemini-2.5-flash',
      {
        inputTokens: 1000,
        outputTokens: 100,
      },
      { google: { usageMetadata: { cachedContentTokenCount: 800, thoughtsTokenCount: 20 } } }
    )
    expect(cost.total).toBeCloseTo(0.0014)
  })
  it('does not treat a reported zero cache-read count as an inclusive V2 cache-write total', async () => {
    const cost = await calculateNativeCost(
      'anthropic/claude-model',
      {
        inputTokens: 100,
        outputTokens: 100,
        cachedInputTokens: 0,
      },
      { anthropic: { cacheReadInputTokens: 0, cacheCreationInputTokens: 100 } }
    )
    expect(cost.total).toBeCloseTo(0.00125)
  })
  it('prices Claude cache-write lifetimes at their documented tariffs', async () => {
    const cost = await calculateNativeCost('anthropic/claude-model', {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheCreationInputTokens: 60_000,
      cacheCreationInputTokens5m: 40_000,
      cacheCreationInputTokens1h: 20_000,
    })
    expect(cost.total).toBeCloseTo(0.26)
  })
  it('keeps unknown prices/counts distinct from an explicitly free tariff', async () => {
    catalogue.pricing.mockReturnValue(undefined)
    expect(await calculateNativeCost('native/model', { inputTokens: 10, outputTokens: 1 })).toEqual(
      { status: 'unavailable' }
    )
    catalogue.pricing.mockReturnValue({ input: 0, output: 0 })
    expect(
      await calculateNativeCost('native/model', { inputTokens: 10, outputTokens: 1 })
    ).toMatchObject({ total: 0, status: 'estimated' })
    expect(await calculateNativeCost('native/model', {})).toEqual({ status: 'unavailable' })
    expect(
      await calculateNativeCost('native/model', {
        inputTokens: 1,
        outputTokens: 0,
        cachedInputTokens: 2,
      })
    ).toEqual({ status: 'unavailable' })
  })
  it('prices input-only embedding usage without inventing output tokens', async () => {
    catalogue.pricing.mockReturnValue({ input: 0.02, output: 0 })
    expect(await calculateNativeCost('openai/embedding', { inputTokens: 1_000_000 })).toMatchObject(
      { input: 0.02, output: 0, total: 0.02, status: 'estimated' }
    )
  })
  it('uses text rates for ordinary Gemini calls and the audio rate only for reported audio tokens', async () => {
    catalogue.pricing.mockReturnValue({ input: 0.3, output: 2.5, input_audio: 1 })
    const usage = { inputTokens: 1000, outputTokens: 100 }
    expect((await calculateNativeCost('google/gemini-2.5-flash', usage)).total).toBeCloseTo(0.00055)
    const metadata = {
      google: {
        usageMetadata: {
          promptTokensDetails: [
            { modality: 'TEXT', tokenCount: 900 },
            { modality: 'AUDIO', tokenCount: 100 },
          ],
        },
      },
    }
    expect(
      (await calculateNativeCost('google/gemini-2.5-flash', usage, metadata)).total
    ).toBeCloseTo(0.00062)
    expect(
      await calculateNativeCost(
        'google/gemini-2.5-flash',
        { ...usage, cachedInputTokens: 100 },
        metadata
      )
    ).toEqual({ status: 'unavailable' })
  })
  it('accumulates the same priced steps and preserves partial coverage', () => {
    const known = { total: 0.0123, currency: 'USD', status: 'reported' as const }
    const estimate = {
      input: 0.001,
      output: 0.002,
      total: 0.003,
      estimated: true,
      status: 'estimated' as const,
    }
    expect(sumNativeCosts([known, estimate])).toMatchObject({ status: 'estimated' })
    expect(sumNativeCosts([known, estimate]).total).toBeCloseTo(0.0153)
    expect(sumNativeCosts([known, { status: 'unavailable' }])).toMatchObject({
      availableTotal: 0.0123,
      status: 'partial',
    })
    expect(sumNativeCosts([{ status: 'unavailable' }])).toEqual({ status: 'unavailable' })
    expect(resultAccounting({ totalTokens: 3 }, known)).toEqual({
      tokens: { total: 3 },
      cost: known,
    })
  })
})
