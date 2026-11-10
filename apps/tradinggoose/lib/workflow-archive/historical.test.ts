import { describe, expect, it, vi } from 'vitest'
import { projectHistoricalFunctionalPayload } from './historical'

vi.mock('@tradinggoose/db', () => ({ db: {} }))

const agent = (output: any, responseFormat?: unknown) => ({
  id: 'a',
  name: 'Agent',
  type: 'agent',
  blockId: 'a',
  duration: 3,
  startTime: '2026-01-01',
  endTime: '2026-01-01',
  input: { messages: [{ role: 'system', content: ' A🔥\n ' }], responseFormat },
  output,
})
describe('offline exact historical functional projection', () => {
  it('retains actual tool inputs/results and exact output while removing only proven Agent reports', () => {
    const output = {
      content: ' actual🔥\n ',
      model: 'historical/model',
      tokens: { total: 5 },
      cost: { total: 2 },
      providerTiming: { timeSegments: [] },
      toolCalls: {
        list: [{ arguments: { fixed: true }, result: { tokens: 'business' } }],
        count: 1,
      },
      toolResults: [{ tokens: 'business' }],
    }
    const projected = projectHistoricalFunctionalPayload([agent(output)], { response: output })
    const { tokens: _tokens, cost: _cost, providerTiming: _timing, ...functional } = output
    expect(projected.output).toEqual({ response: functional })
    expect(projected.blocks[0].output).toEqual(functional)
    expect(projected.blocks[0].input).toEqual(agent(output).input)
    expect(projected.blocks[0]).not.toHaveProperty('tokens')
  })
  it('keeps ordinary schema-owned business names and never recursively strips arbitrary matching keys', () => {
    const output = { model: 'business', nested: { tokens: 9, cost: 4 }, tokens: { total: 5 } }
    const projected = projectHistoricalFunctionalPayload(
      [agent(output, { schema: { type: 'object', properties: { model: {}, nested: {} } } })],
      { tokens: 'intentional response-block field', nested: { cost: 'business' } }
    )
    expect(projected.blocks[0].output).toEqual({
      model: 'business',
      nested: { tokens: 9, cost: 4 },
    })
    expect(projected.output).toEqual({
      tokens: 'intentional response-block field',
      nested: { cost: 'business' },
    })
  })
  it.each(['tokens', 'cost', 'providerTiming', 'toolCalls', 'toolResults'])(
    'pins an actually overwritten structured %s rather than fabricate its lost value',
    (key) => {
      expect(() =>
        projectHistoricalFunctionalPayload(
          [agent({ [key]: 'server-overwrite' }, { schema: { properties: { [key]: {} } } })],
          {}
        )
      ).toThrow('overwritten')
    }
  )
  it('pins malformed and unresolved root union schemas for explicit source classification', () => {
    for (const format of ['{', { schema: { $ref: '#/business' } }])
      expect(() => projectHistoricalFunctionalPayload([agent({}, format)], {})).toThrow('pinned')
  })
})
