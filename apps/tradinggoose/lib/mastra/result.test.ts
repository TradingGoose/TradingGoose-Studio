import { describe, expect, it } from 'vitest'
import { extractAgentOutput } from '@/executor/handlers/agent/agent-handler'
import {
  assertNativeCompletion,
  getInferenceFacts,
  getNativeFinalText,
  isInferenceResult,
  withInferenceFacts,
} from './result'

it('rejects unfinished native tool loops while accepting final model answers', () => {
  expect(() => assertNativeCompletion({ finishReason: 'tool-calls' })).toThrow('step limit')
  for (const finishReason of ['stop', 'length'])
    expect(() => assertNativeCompletion({ finishReason })).not.toThrow()
})

it.each(['', ' \n\t '])(
  'rejects a blank final answer despite earlier native commentary (%j)',
  (text) => {
    const result = {
      text: `Intermediate commentary${text}`,
      steps: [{ text: 'Intermediate commentary' }, { text }],
    }
    expect(() => getNativeFinalText(result)).toThrow('final answer')
  }
)

it('requires a final native step and returns its exact untrimmed answer', () => {
  expect(() => getNativeFinalText({ steps: [] })).toThrow('final answer')
  const text = ' \nFinal answer\t\n'
  expect(getNativeFinalText({ steps: [{ text: 'Intermediate commentary' }, { text }] })).toBe(text)
})

describe('structured business roots and trusted facts', () => {
  it('accepts a valid structured object without requiring text content', () => {
    const output = extractAgentOutput(
      { object: { answer: 42 }, steps: [{ text: '' }], finishReason: 'stop' },
      'openai/gpt-4.1',
      { tokens: {}, cost: { status: 'unavailable' } },
      true
    )
    expect(output).toMatchObject({ answer: 42 })
    expect(output).not.toHaveProperty('content')
  })
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
      { object, steps: [{ text: JSON.stringify(object) }], finishReason: 'stop' },
      'openai/gpt-4.1',
      { tokens: { total: 5 }, cost: { status: 'unavailable' } },
      true
    )
    expect(Object.fromEntries(Object.entries(output))).toEqual(object)
    expect(getInferenceFacts(output)).toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { total: 5 },
      cost: { status: 'unavailable' },
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
