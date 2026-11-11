import { describe, expect, it, vi } from 'vitest'
import type { TraceSpan } from '@/lib/logs/types'
import { type InferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { resultAccounting } from '@/lib/mastra/usage'

vi.mock('@tradinggoose/db', () => ({ db: {} }))

import { calculateCostSummary } from './logging-factory'

type Facts = Omit<InferenceFacts, 'generatedFields'>
function span(id: string, facts: Facts, extra: Partial<TraceSpan> = {}): TraceSpan {
  return {
    id,
    name: id,
    type: 'agent',
    blockId: id,
    duration: 1,
    startTime: '2026-11-10T00:00:00.000Z',
    endTime: '2026-11-10T00:00:00.001Z',
    ...extra,
    inference: { ...facts, generatedFields: [] },
  }
}
function callback(toolCallId: string, facts: Facts) {
  return { toolCallId, inference: { ...facts, generatedFields: [] } }
}

describe('execution native accounting', () => {
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
      span('provider-total', { model: 'native/test', cost: { total: 0.01, status: 'reported' } }),
      span('estimated-detail', {
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
          span('partial', {
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
      span('estimated', { model: 'native/test', cost: { total: 0.002, status: 'estimated' } }),
      span('missing', { model: 'native/test', cost: { status: 'unavailable' } }),
    ]
    if (reverse) components.reverse()
    const model = calculateCostSummary(components).models['native/test']
    expect(model).toMatchObject({ status: 'partial', estimated: true, availableTotal: 0.002 })
    expect(model.total).toBeUndefined()
  })

  it('retains a real complete zero model cost and leaves wholly missing model cost unavailable', () => {
    const models = calculateCostSummary([
      span('free', { model: 'native/free', cost: { total: 0, status: 'reported' } }),
      span('missing', { model: 'native/missing', cost: { status: 'unavailable' } }),
    ]).models
    expect(models['native/free']).toMatchObject({ total: 0, availableTotal: 0, status: 'reported' })
    expect(models['native/missing']).toMatchObject({ status: 'unavailable' })
    expect(models['native/missing'].total).toBeUndefined()
    expect(models['native/missing'].availableTotal).toBeUndefined()
  })

  it('deduplicates span copies without adding product charges to model reports', () => {
    const one = span('a', {
      model: 'openai/test',
      tokens: { prompt: 10, completion: 2, total: 12 },
      cost: { total: 0.004, status: 'reported' },
    })
    const two = span('b', {
      model: 'openai/test',
      tokens: { prompt: 5, completion: 1, total: 6 },
      cost: { total: 0.002, status: 'reported' },
    })
    const result = calculateCostSummary([{ ...one, children: [{ ...one }] }, two])
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
      span('a', { model: 'native/test', cost: { status: 'unavailable' }, tokens: { total: 100 } }),
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
        span('estimate', { cost: { total: 0, status: 'estimated' }, tokens: { total: 1 } }),
      ])
    ).toMatchObject({ totalCost: 0, modelCost: 0, status: 'estimated', totalTokens: 1 })
    expect(calculateCostSummary([span('missing', { tokens: { total: 1 } })])).toMatchObject({
      status: 'unavailable',
      totalTokens: 1,
    })
  })

  it('keeps trusted charge-only callbacks separate from model spend and includes them once', () => {
    const result = calculateCostSummary([
      span('a', { cost: { total: 0.004, status: 'reported' }, toolCost: 0.002 }),
    ])
    expect(result).toMatchObject({
      modelCost: 0.004,
      toolCost: 0.002,
      availableTotal: 0.006,
      totalCost: 0.006,
    })
  })
})

it('aggregates callback model charges and tokens once regardless of their call location', () => {
  const childFacts: Facts = {
    model: 'native/inner',
    tokens: { total: 20 },
    cost: { total: 0.002, status: 'estimated' },
  }
  const child = callback('inner', childFacts)
  const outer = span('outer', {
    model: 'native/outer',
    tokens: { total: 10 },
    cost: { total: 0.004, status: 'reported' },
    toolCost: 0.004,
    toolResults: [child, child],
  })
  expect(calculateCostSummary(JSON.parse(JSON.stringify([outer])))).toEqual(
    calculateCostSummary([outer])
  )
  expect(calculateCostSummary([outer])).toMatchObject({
    totalCost: 0.006,
    modelCost: 0.006,
    toolCost: 0,
    totalTokens: 30,
    status: 'estimated',
    estimated: true,
  })
  expect(calculateCostSummary([{ ...outer, children: [span('inner', childFacts)] }])).toMatchObject(
    {
      totalCost: 0.006,
      totalTokens: 30,
    }
  )
})

it('counts combined native guardrail cost as model spend without requiring a single model ID', () => {
  const guardrail = callback('guardrail-call', {
    tokens: { total: 8 },
    cost: { total: 0.5, currency: 'USD', status: 'estimated' },
  })
  const product = callback('function-call', { toolCost: 0.125 })
  const result = calculateCostSummary([
    span('outer', {
      model: 'native/outer',
      tokens: { total: 2 },
      cost: { total: 0.25, status: 'reported' },
      toolResults: [guardrail, guardrail, product],
    }),
  ])
  expect(result).toMatchObject({
    totalTokens: 10,
    modelCost: 0.75,
    toolCost: 0.125,
    totalCost: 0.875,
    status: 'estimated',
  })
})

it('keeps unavailable embedding callback usage and failure costs in the available subtotal', () => {
  const child = callback('embedding', {
    model: 'native/embedding',
    tokens: { prompt: 13, total: 13 },
    cost: { status: 'unavailable' },
    embeddingUsage: { status: 'reported', batches: 1 },
  })
  expect(
    calculateCostSummary([
      span('outer', {
        cost: { total: 0.004, status: 'reported' },
        tokens: { total: 10 },
        toolResults: [child],
      }),
    ])
  ).toMatchObject({
    totalCost: undefined,
    availableTotal: 0.004,
    totalTokens: 23,
    status: 'partial',
    unavailableComponents: 1,
  })
})

it('uses native callback identities to count separate calls', () => {
  const facts: Facts = { tokens: { total: 4 }, cost: { total: 0.001, status: 'reported' } }
  const toolResults = [callback('first-call', facts), callback('second-call', facts)]
  expect(
    calculateCostSummary([
      span('outer', { cost: { total: 0.004, status: 'reported' }, toolResults }),
    ])
  ).toMatchObject({ totalCost: 0.006, modelCost: 0.006, toolCost: 0, totalTokens: 8 })
})

it('keeps unknown usage unknown and genuine reported zero available', () => {
  const unknown = calculateCostSummary([span('unknown', { model: 'native/missing' })])
  expect(unknown).toMatchObject({
    status: 'unavailable',
    totalCost: undefined,
    availableTotal: undefined,
    totalTokens: undefined,
    totalPromptTokens: undefined,
    totalCompletionTokens: undefined,
  })
  const mixed = calculateCostSummary([
    span('zero', { cost: { total: 0, status: 'reported' }, tokens: { prompt: 0 } }),
    span('missing', { cost: { status: 'unavailable' } }),
  ])
  expect(mixed).toMatchObject({
    status: 'partial',
    availableTotal: 0,
    totalPromptTokens: 0,
    totalTokens: undefined,
    totalCompletionTokens: undefined,
  })
})

it('uses trusted active tool facts despite schema-owned report field names', () => {
  const child = callback('tool', {
    model: 'native/real',
    cost: { status: 'unavailable' },
    tokens: { prompt: 0, total: 3 },
  })
  const result = calculateCostSummary([span('parent', { toolResults: [child] })])
  expect(result).toMatchObject({
    status: 'unavailable',
    totalTokens: 3,
    totalPromptTokens: 0,
    totalCompletionTokens: undefined,
    availableTotal: undefined,
    models: { 'native/real': { status: 'unavailable' } },
  })
  expect(result.models).not.toHaveProperty('31')
  expect(Object.keys(child).sort()).toEqual(['inference', 'toolCallId'])
})

it('does not accept raw top-level roots or component.output as an inference carrier', () => {
  const raw = {
    ...span('ordinary', {}),
    inference: undefined,
    model: 'business-model',
    tokens: { total: 9999 },
    cost: { total: 999, status: 'reported' as const },
    output: { toolCost: 123, toolResults: [callback('hidden', { tokens: { total: 456 } })] },
  }
  const result = calculateCostSummary([raw])
  expect(result.totalTokens).toBeUndefined()
  expect(result.models).toEqual({})
  expect(result.toolCost).toBe(0)
})

it('counts trusted nested callbacks once without adding inclusive native/tool subtotals', () => {
  const embedding = callback('embedding-call', {
    model: 'native/embedding',
    tokens: { total: 3 },
    cost: { status: 'unavailable' },
  })
  const nested = callback('nested-call', {
    model: 'native/nested',
    tokens: { total: 7 },
    cost: { total: 0.002, status: 'reported' },
    toolCost: 999,
    toolResults: [embedding, embedding],
  })
  const result = calculateCostSummary([
    span('outer', {
      model: 'native/outer',
      tokens: { total: 10 },
      cost: { total: 0.004, status: 'reported' },
      toolCost: 888,
      toolResults: [nested, nested],
    }),
  ])
  expect(result).toMatchObject({
    totalTokens: 20,
    modelCost: 0.006,
    toolCost: 0,
    availableTotal: 0.006,
    totalCost: undefined,
    status: 'partial',
    unavailableComponents: 1,
  })
  expect(Object.keys(result.models).sort()).toEqual([
    'native/embedding',
    'native/nested',
    'native/outer',
  ])
})

it.each(['workflow', 'workflow_input'])('continues excluding inclusive child-%s traces', (type) => {
  const child = span(
    'child-workflow',
    { tokens: { total: 9999 }, cost: { total: 100, status: 'reported' } },
    {
      type,
      children: [
        span('nested-agent', { tokens: { total: 9999 }, cost: { status: 'unavailable' } }),
      ],
    }
  )
  expect(
    calculateCostSummary([
      span('own', { tokens: { total: 10 }, cost: { status: 'unavailable' } }),
      child,
    ]).totalTokens
  ).toBe(10)
})

it('retains partial public counts without inventing a completion count', () => {
  const selected = resultAccounting({ inputTokens: 0, totalTokens: 17 })
  const result = calculateCostSummary([span('selected', { model: 'native/selected', ...selected })])
  expect(result).toMatchObject({
    totalTokens: 17,
    totalPromptTokens: 0,
    totalCompletionTokens: undefined,
    status: 'unavailable',
    availableTotal: undefined,
  })
})

it('accepts an own-branded server span and charge-only child without raw business-field promotion', () => {
  const charge = callback('charge-only', { toolCost: 0.003 })
  const outer = withInferenceFacts(span('server-span', {}), {
    model: 'native/real',
    tokens: { total: 10 },
    cost: { total: 0.004, status: 'reported' },
    toolResults: [charge],
    generatedFields: [],
  })
  expect(calculateCostSummary([outer])).toMatchObject({
    totalTokens: 10,
    modelCost: 0.004,
    toolCost: 0.003,
    totalCost: 0.007,
    status: 'reported',
  })
  expect(calculateCostSummary([outer]).models).not.toHaveProperty('business-model')
})
