import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setManagedProviders } from './__test-utils__/managed-services'
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
      vercel: { models: { 'openai/gpt-4o': model } },
      anthropic: { models: { 'claude-model': model } },
      google: { models: { 'gemini-2.5-flash': model, 'gemini-2.5-pro': model } },
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

describe('account-funded cost projection', () => {
  const byok = {
    input: 1.5,
    output: 0.5,
    total: 2,
    currency: 'USD',
    estimated: true,
    status: 'estimated' as const,
    accountCost: null,
  }
  const account = {
    input: 0.75,
    output: 0.25,
    total: 1,
    currency: 'USD',
    status: 'estimated' as const,
  }

  it('retains standard reference dollars and the account subtotal through nested aggregation', () => {
    const combined = sumNativeCosts([byok, account])
    expect(combined).toMatchObject({
      input: 2.25,
      output: 0.75,
      total: 3,
      accountCost: { input: 0.75, output: 0.25, total: 1, status: 'estimated' },
    })
    const nested = sumNativeCosts([combined, byok])
    expect(nested).toMatchObject({ total: 5, accountCost: { total: 1 } })
    expect(sumNativeCosts(JSON.parse(JSON.stringify([combined, byok])))).toEqual(nested)
    expect(byok.total).toBe(2)
    expect(byok.accountCost).toBeNull()
    expect(sumNativeCosts([account])).not.toHaveProperty('accountCost')
  })

  it('keeps unknown BYOK reference prices separate from a known account subtotal', () => {
    const unknownByok = { status: 'unavailable' as const, accountCost: null }
    expect(sumNativeCosts([unknownByok, account])).toMatchObject({
      status: 'partial',
      availableTotal: 1,
      accountCost: { total: 1, status: 'estimated' },
    })
    expect(sumNativeCosts([unknownByok])).toMatchObject({
      status: 'unavailable',
      accountCost: { total: 0, status: 'reported' },
    })
  })

  it('does not make unknown account prices known by adding a BYOK estimate', () => {
    const cost = sumNativeCosts([byok, { status: 'unavailable' }])
    expect(cost).toMatchObject({
      status: 'partial',
      availableTotal: 2,
      accountCost: { status: 'partial', availableTotal: 0 },
    })
    expect(cost.accountCost).not.toHaveProperty('total')
  })
})

describe('native per-step USD pricing', () => {
  it.each(['vercel/openai/gpt-4o', 'openrouter/model'])(
    'uses standard catalog prices for %s independently of provider dollar and BYOK metadata',
    async (model) => {
      for (const reported of [0, 99, -1, 'not-a-dollar']) {
        const cost = await calculateNativeCost(
          model,
          { inputTokens: 1000, outputTokens: 100 },
          {
            gateway: { cost: reported },
            openrouter: {
              usage: {
                cost: reported,
                isByok: true,
                costDetails: { upstreamInferenceCost: 25 },
              },
            },
          }
        )
        expect(cost).toMatchObject({ total: 0.0028, currency: 'USD', status: 'estimated' })
      }
    }
  )
  it('does not replace missing catalog prices or token counts with provider dollar totals', async () => {
    const metadata = { gateway: { cost: 99 }, openrouter: { usage: { cost: 99 } } }
    const usage = { inputTokens: 1000, outputTokens: 100 }
    for (const model of ['vercel/openai/gpt-4o', 'openrouter/model']) {
      expect(await calculateNativeCost(model, {}, metadata)).toEqual({ status: 'unavailable' })
    }
    catalogue.pricing.mockReturnValue(undefined)
    for (const model of ['vercel/openai/gpt-4o', 'openrouter/model']) {
      expect(await calculateNativeCost(model, usage, metadata)).toEqual({ status: 'unavailable' })
    }
  })
  it('does not borrow published rates or billing metadata for an overridden endpoint', async () => {
    setManagedProviders({
      openai: { name: 'Private endpoint', url: 'https://private.invalid/v1', models: ['model'] },
    })
    const cost = await calculateNativeCost(
      'openai/model',
      { inputTokens: 1000, outputTokens: 100 },
      { openrouter: { usage: { cost: 0 } } }
    )
    expect(cost).toEqual({ status: 'unavailable' })
    expect(catalogue.pricing).not.toHaveBeenCalled()
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
  it.each([
    [199_999, 0.25999875],
    [200_000, 0.26],
    [200_001, 0.5150025],
  ])(
    'prices Gemini Pro at %i input tokens using the documented exclusive threshold',
    async (inputTokens, total) => {
      catalogue.pricing.mockReturnValue({
        input: 1.25,
        output: 10,
        tiers: [{ tier: { size: 200_000 }, input: 2.5, output: 15 }],
      })
      const cost = await calculateNativeCost('google/gemini-2.5-pro', {
        inputTokens,
        outputTokens: 1000,
      })
      expect(cost).toMatchObject({ status: 'estimated', currency: 'USD' })
      expect(cost.total).toBeCloseTo(total, 10)
    }
  )
  it.each([
    [200_000, 0.201225],
    [200_001, 0.609978],
    [500_000, 1.509975],
    [500_001, 3.019956],
  ])(
    'prices cache and reasoning consistently across context tiers at %i input tokens',
    async (inputTokens, total) => {
      catalogue.pricing.mockReturnValue({
        input: 1,
        output: 2,
        cache_read: 0.1,
        cache_write: 1.25,
        reasoning: 3,
        tiers: [
          {
            tier: { size: 500_000 },
            input: 6,
            output: 24,
            cache_read: 0.6,
            cache_write: 7.5,
            reasoning: 36,
          },
          {
            tier: { size: 200_000 },
            input: 3,
            output: 12,
            cache_read: 0.3,
            cache_write: 3.75,
            reasoning: 18,
          },
        ],
      })
      const cost = await calculateNativeCost('native/model', {
        inputTokens,
        outputTokens: 1000,
        cachedInputTokens: 1000,
        cacheCreationInputTokens: 100,
        reasoningTokens: 100,
      })
      expect(cost.total).toBeCloseTo(total, 10)
    }
  )
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
