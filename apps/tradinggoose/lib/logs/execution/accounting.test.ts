import { describe, expect, it } from 'vitest'
import type { InferenceFacts } from '@/lib/mastra/result'
import { resultAccounting, sumNativeCosts } from '@/lib/mastra/usage'
import { calculateCostSummary } from './logging-factory'

const entry = (facts: Omit<InferenceFacts, 'generatedFields'>): InferenceFacts => ({
  ...facts,
  generatedFields: [],
})

describe('execution native accounting', () => {
  it('retains BYOK reference estimates while summarizing only account-funded dollars', () => {
    const byok = entry({
      model: 'native/shared',
      tokens: { total: 15 },
      cost: { input: 1.5, output: 0.5, total: 2, status: 'estimated', accountCost: null },
    })
    const account = entry({
      model: 'native/shared',
      tokens: { total: 10 },
      cost: { input: 0.75, output: 0.25, total: 1, status: 'estimated' },
    })
    const result = calculateCostSummary([byok, account])
    expect(result).toMatchObject({
      totalCost: 1,
      modelCost: 1,
      totalInputCost: 0.75,
      totalOutputCost: 0.25,
      totalTokens: 25,
      models: { 'native/shared': { total: 1, tokens: { total: 25 } } },
    })
    expect(byok.cost).toMatchObject({ total: 2, accountCost: null })
    expect(calculateCostSummary(JSON.parse(JSON.stringify([byok, account])))).toEqual(result)
  })

  it('keeps mixed guardrail funding through aggregation and JSON transport', () => {
    const cost = sumNativeCosts([
      { total: 1, status: 'estimated' },
      { total: 2, status: 'estimated', accountCost: null },
    ])
    const guardrail = entry({ cost, tokens: { total: 30 } })
    expect(cost.total).toBe(3)
    expect(calculateCostSummary(JSON.parse(JSON.stringify([guardrail])))).toMatchObject({
      totalCost: 1,
      modelCost: 1,
      totalTokens: 30,
    })
  })

  it('does not make account charges unknown because a BYOK estimate is unavailable', () => {
    expect(
      calculateCostSummary([
        entry({ cost: { status: 'unavailable', accountCost: null }, tokens: { total: 3 } }),
        entry({ cost: { total: 1, status: 'estimated' }, tokens: { total: 2 } }),
      ])
    ).toMatchObject({ totalCost: 1, totalTokens: 5, status: 'estimated', unavailableComponents: 0 })
  })

  it('keeps execution-only workflows at zero without inventing model token counts', () => {
    expect(calculateCostSummary([])).toMatchObject({
      totalCost: 0,
      availableTotal: 0,
      modelCost: 0,
      status: 'reported',
      totalTokens: undefined,
      models: {},
    })
  })

  it('leaves incomplete input/output cost breakdowns unknown while preserving the total', () => {
    const result = calculateCostSummary([
      entry({ model: 'native/test', cost: { total: 0.01, status: 'reported' } }),
      entry({
        model: 'native/test',
        cost: { input: 0.002, output: 0.003, total: 0.005, status: 'estimated' },
      }),
    ])
    expect(result).toMatchObject({ totalCost: 0.015, modelCost: 0.015, status: 'estimated' })
    expect(result.totalInputCost).toBeUndefined()
    expect(result.totalOutputCost).toBeUndefined()
    expect(result.models['native/test'].input).toBeUndefined()
    expect(result.models['native/test'].output).toBeUndefined()
  })

  it.each([false, true])(
    'preserves partial model amounts and estimate metadata (%s)',
    (estimated) => {
      for (const availableTotal of [0, 0.002]) {
        const result = calculateCostSummary([
          entry({
            model: 'native/test',
            tokens: { total: 12 },
            cost: { status: 'partial', estimated, availableTotal },
          }),
        ])
        expect(result.models['native/test']).toMatchObject({
          status: 'partial',
          estimated,
          availableTotal,
          tokens: { total: 12 },
        })
        expect(result.models['native/test'].total).toBeUndefined()
      }
    }
  )

  it.each([false, true])('keeps mixed model components partial in either order (%s)', (reverse) => {
    const components = [
      entry({ model: 'native/test', cost: { total: 0.002, status: 'estimated' } }),
      entry({ model: 'native/test', cost: { status: 'unavailable' } }),
    ]
    if (reverse) components.reverse()
    const model = calculateCostSummary(components).models['native/test']
    expect(model).toMatchObject({ status: 'partial', estimated: true, availableTotal: 0.002 })
    expect(model.total).toBeUndefined()
  })

  it('retains a real complete zero model cost and leaves wholly missing model cost unavailable', () => {
    const models = calculateCostSummary([
      entry({ model: 'native/free', cost: { total: 0, status: 'reported' } }),
      entry({ model: 'native/missing', cost: { status: 'unavailable' } }),
    ]).models
    expect(models['native/free']).toMatchObject({ total: 0, availableTotal: 0, status: 'reported' })
    expect(models['native/missing']).toMatchObject({ status: 'unavailable' })
    expect(models['native/missing'].total).toBeUndefined()
    expect(models['native/missing'].availableTotal).toBeUndefined()
  })

  it('sums independent ledger entries without adding product charges to model reports', () => {
    const one = entry({
      model: 'openai/test',
      tokens: { prompt: 10, completion: 2, total: 12 },
      cost: { total: 0.004, status: 'reported' },
    })
    const two = entry({
      model: 'openai/test',
      tokens: { prompt: 5, completion: 1, total: 6 },
      cost: { total: 0.002, status: 'reported' },
    })
    const result = calculateCostSummary([one, two])
    expect(result).toMatchObject({
      modelCost: 0.006,
      totalCost: 0.006,
      totalTokens: 18,
      status: 'reported',
    })
    expect(result).not.toHaveProperty('baseExecutionCharge')
  })

  it('retains cost-less completed tokens without fabricating an available subtotal', () => {
    const result = calculateCostSummary([
      entry({ model: 'native/test', cost: { status: 'unavailable' }, tokens: { total: 100 } }),
    ])
    expect(result).toMatchObject({
      totalTokens: 100,
      availableTotal: undefined,
      status: 'unavailable',
      unavailableComponents: 1,
    })
    expect(result.totalCost).toBeUndefined()
    expect(result.modelCost).toBeUndefined()
    expect(result.models['native/test'].total).toBeUndefined()
  })

  it('keeps native zero distinct from missing and estimates labelled', () => {
    expect(
      calculateCostSummary([
        entry({ cost: { total: 0, status: 'estimated' }, tokens: { total: 1 } }),
      ])
    ).toMatchObject({ totalCost: 0, modelCost: 0, status: 'estimated', totalTokens: 1 })
    expect(calculateCostSummary([entry({ tokens: { total: 1 } })])).toMatchObject({
      status: 'unavailable',
      totalTokens: 1,
    })
  })
})

it('counts separate admitted attempts even when their reported usage is identical', () => {
  const facts = entry({ tokens: { total: 4 }, cost: { total: 0.001, status: 'reported' } })
  expect(calculateCostSummary([facts, { ...facts }])).toMatchObject({
    totalCost: 0.002,
    totalTokens: 8,
  })
})

it('retains partial public counts without inventing a completion count', () => {
  const selected = resultAccounting({ inputTokens: 0, totalTokens: 17 })
  expect(calculateCostSummary([entry({ model: 'native/selected', ...selected })])).toMatchObject({
    totalTokens: 17,
    totalPromptTokens: 0,
    totalCompletionTokens: undefined,
    status: 'unavailable',
    availableTotal: undefined,
  })
})
