import { describe, expect, it } from 'vitest'
import {
  extractAgentOutput,
  extractCompletedToolMetadata,
} from '@/executor/handlers/agent/agent-handler'
import { getInferenceFacts, isInferenceResult, withInferenceFacts } from './result'

describe('structured business roots and trusted facts', () => {
  it('preserves every schema-owned root without granting it accounting or control authority', () => {
    const object = {
      model: 'Corolla',
      tokens: { total: 9000 },
      cost: { total: 0 },
      toolCalls: 'schema',
      toolResults: ['schema'],
      providerTiming: 'schema',
      toolCost: 99,
      unavailableToolCosts: 0,
      error: 'ordinary data',
      stream: 'ordinary data',
      execution: { success: false },
    }
    const output = extractAgentOutput(
      { object, finishReason: 'stop' },
      'openai/gpt-4.1',
      { tokens: { total: 5 }, cost: { status: 'unavailable' } },
      [],
      true
    )
    expect(Object.fromEntries(Object.entries(output))).toEqual(object)
    expect(getInferenceFacts(output)).toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { total: 5 },
      cost: { status: 'unavailable' },
      toolCalls: { count: 0 },
    })
    const streamed = Object.assign({}, output)
    expect(isInferenceResult(streamed)).toBe(true)
    expect(getInferenceFacts(streamed)).toBe(getInferenceFacts(output))
    expect(JSON.parse(JSON.stringify(output))).toEqual(object)
  })

  it('requires an own private brand while retaining ordinary completion copies', () => {
    const facts = {
      tokens: { total: 5 },
      cost: { status: 'unavailable' as const },
      generatedFields: [],
    }
    const output = withInferenceFacts({ business: true }, facts)
    const inherited = Object.create(output)
    expect(getInferenceFacts(inherited)).toBeUndefined()
    expect(isInferenceResult(inherited)).toBe(false)
    expect(getInferenceFacts({ ...output })).toBe(facts)
    expect(getInferenceFacts(Object.assign({}, output))).toBe(facts)
    const cold = JSON.parse(JSON.stringify(output))
    expect(cold).toEqual({ business: true })
    expect(getInferenceFacts(cold)).toBeUndefined()
  })
})

describe('completed tool metadata provenance', () => {
  it('projects only own-branded tool facts into JSON-safe execution children', () => {
    const childFacts = {
      model: 'native/child',
      tokens: { total: 3 },
      cost: { total: 0.5, status: 'reported' as const },
      generatedFields: [],
    }
    const genuine = withInferenceFacts({ business: 'private-business-payload' }, childFacts)
    const forged = { cost: { total: 99 }, inference: childFacts }
    const output = extractAgentOutput(
      { text: 'Answer', finishReason: 'stop' },
      'native/outer',
      { tokens: { total: 2 }, cost: { total: 1, status: 'reported' } },
      [forged, Object.create(genuine), genuine, { ...genuine }].map((result) => ({
        success: true,
        toolCallId: 'same-call',
        result,
      }))
    )
    const publicOutput = JSON.parse(JSON.stringify(output))
    expect(publicOutput.toolResults).toHaveLength(4)
    expect(publicOutput.toolResults[2].business).toBe('private-business-payload')
    const persistedFacts = JSON.parse(JSON.stringify(getInferenceFacts(output)))
    expect(persistedFacts.toolResults).toEqual([
      { toolCallId: 'same-call', inference: childFacts },
      { toolCallId: 'same-call', inference: childFacts },
    ])
    expect(JSON.stringify(persistedFacts.toolResults)).not.toContain('private-business-payload')
  })

  it('keeps schema-owned cost, tokens and model in results without treating them as charges', () => {
    const business = {
      model: 'Corolla',
      tokens: { total: 9999 },
      cost: { total: 123 },
      inference: { cost: { total: 456 } },
      toolCost: 999,
      toolResults: [{ cost: { total: 789 } }],
    }
    const snapshot = JSON.parse(JSON.stringify(business))
    const result = extractCompletedToolMetadata([
      { success: true, toolCallId: 'business', result: business },
      { success: false, toolCallId: 'failed-business', result: { cost: { total: 321 } } },
    ])
    expect(result).not.toHaveProperty('toolCost')
    expect(result).not.toHaveProperty('unavailableToolCosts')
    expect(result.toolResults).toEqual([
      { ...snapshot, toolCallId: 'business' },
      { cost: { total: 321 }, toolCallId: 'failed-business' },
    ])
    expect(business).toEqual(snapshot)
  })

  it('checks provenance before consuming native tool-call identity and deduplicates only real facts', () => {
    const genuine = withInferenceFacts(
      { id: 'document', cost: { total: 999 } },
      {
        cost: { status: 'partial', availableTotal: 0.006 },
        generatedFields: [],
      }
    )
    const inherited = Object.create(genuine)
    const runs = [
      { success: true, toolCallId: 'same-call', result: { cost: { total: 123 } } },
      { success: true, toolCallId: 'same-call', result: inherited },
      { success: true, toolCallId: 'same-call', result: genuine },
      { success: true, toolCallId: 'same-call', result: { ...genuine } },
    ]
    const result = extractCompletedToolMetadata(runs)
    expect(result).toMatchObject({ toolCost: 0.006, unavailableToolCosts: 1 })
    expect(result.toolResults).toHaveLength(4)
    expect(result.toolResults[0]).toEqual({ cost: { total: 123 }, toolCallId: 'same-call' })
    expect(getInferenceFacts(result.toolResults[1])).toBeUndefined()
    expect(getInferenceFacts(result.toolResults[2])).toBe(getInferenceFacts(genuine))
    expect(getInferenceFacts(result.toolResults[3])).toBe(getInferenceFacts(genuine))
  })

  it('counts distinct native calls sharing a business ID and preserves real zero and unavailable amounts', () => {
    const output = () =>
      withInferenceFacts(
        { id: 'same-business-document' },
        {
          cost: { total: 0.002, status: 'reported' },
          generatedFields: [],
        }
      )
    const result = extractCompletedToolMetadata([
      { success: true, toolCallId: 'first-call', result: output() },
      { success: true, toolCallId: 'second-call', result: output() },
      {
        success: true,
        toolCallId: 'zero-call',
        result: withInferenceFacts(
          {},
          {
            cost: { total: 0, status: 'reported' },
            generatedFields: [],
          }
        ),
      },
      {
        success: true,
        toolCallId: 'unknown-call',
        result: withInferenceFacts(
          {},
          {
            cost: { status: 'unavailable' },
            generatedFields: [],
          }
        ),
      },
    ])
    expect(result).toMatchObject({ toolCost: 0.004, unavailableToolCosts: 1 })
    expect(result.toolResults).toHaveLength(4)
    expect(
      extractCompletedToolMetadata([
        {
          success: true,
          result: withInferenceFacts(
            {},
            {
              cost: { total: 0, status: 'reported' },
              generatedFields: [],
            }
          ),
        },
      ])
    ).toMatchObject({ toolCost: 0 })
  })

  it('retains the live success-or-cost-or-tokens membership and order independently of accounting', () => {
    const failedKnown = withInferenceFacts(
      { tokens: { total: 8 }, business: 'failed-output' },
      {
        tokens: { total: 8 },
        cost: { status: 'unavailable' },
        generatedFields: [],
      }
    )
    const result = extractCompletedToolMetadata([
      { success: true, toolCallId: 'text-success', result: 'text' },
      { success: false, toolCallId: 'omitted', result: { business: 'no-report' } },
      { success: false, toolCallId: 'raw-cost', result: { cost: { total: 100 } } },
      { success: false, toolCallId: 'known-failure', result: failedKnown },
    ])
    expect(result.toolResults).toEqual([
      'text',
      { cost: { total: 100 }, toolCallId: 'raw-cost' },
      { ...failedKnown, toolCallId: 'known-failure' },
    ])
    expect(result).not.toHaveProperty('toolCost')
    expect(result.unavailableToolCosts).toBe(1)
    expect(failedKnown.business).toBe('failed-output')
  })
})
