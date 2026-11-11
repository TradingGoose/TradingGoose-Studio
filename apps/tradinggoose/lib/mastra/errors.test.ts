import { describe, expect, it } from 'vitest'
import { getFailureAccounting } from './errors'
import { getInferenceFacts, withInferenceFacts } from './result'

describe('local failure accounting provenance', () => {
  it('redacts the public copy while preserving only its existing private facts through generic wrappers', () => {
    const childFacts = {
      model: 'native/child',
      tokens: { total: 5 },
      cost: { status: 'unavailable' as const },
      generatedFields: ['model', 'tokens', 'cost'],
    }
    const child = withInferenceFacts(
      {
        model: 'native/child',
        tokens: { total: 5 },
        cost: { status: 'unavailable' },
        answer: 'done',
      },
      childFacts
    )
    const facts = {
      model: 'native/model',
      tokens: { prompt: 11, completion: 6, total: 17 },
      cost: { status: 'unavailable' as const },
      toolResults: [{ toolCallId: 'child-call', inference: childFacts }],
      generatedFields: ['model', 'tokens', 'cost', 'toolResults'],
    }
    const failure = withInferenceFacts(
      Object.assign(new Error('apiKey=synthetic-r10-key'), {
        model: facts.model,
        tokens: facts.tokens,
        cost: facts.cost,
        toolResults: [{ result: child, apiKey: 'synthetic-r10-key' }],
        request: { headers: { authorization: 'Bearer synthetic-r10-key' } },
        response: { raw: 'private diagnostic' },
      }),
      facts
    )
    const accounting = getFailureAccounting(failure)
    expect(accounting).not.toBe(failure)
    expect(accounting).toMatchObject({ model: facts.model, tokens: facts.tokens, cost: facts.cost })
    expect(accounting).not.toHaveProperty('request')
    expect(accounting).not.toHaveProperty('response')
    expect(JSON.stringify(accounting)).not.toContain('synthetic-r10-key')
    expect(getInferenceFacts(accounting)).toBe(facts)
    expect(getInferenceFacts({ ...accounting })).toBe(facts)
    expect(getInferenceFacts(Object.assign({}, accounting))).toBe(facts)
    expect(getInferenceFacts(accounting)?.toolResults?.[0].inference).toBe(childFacts)
    expect(getInferenceFacts(child)).toBe(childFacts)
    expect(getInferenceFacts(failure)).toBe(facts)
    expect(failure.message).toBe('apiKey=synthetic-r10-key')
  })

  it.each([
    {
      model: 'business model',
      tokens: { total: 17 },
      cost: { status: 'unavailable' },
      inference: { generatedFields: ['tokens', 'cost'] },
    },
    JSON.parse(
      '{"name":"Error","model":"native/model","tokens":{"total":17},"cost":{"status":"unavailable"},"inference":{"generatedFields":["tokens","cost"]}}'
    ),
    new Error('HTTP error with no local inference provenance'),
  ])('does not create accounting authority from unbranded error/HTTP/JSON fields', (failure) => {
    const accounting = getFailureAccounting(failure)
    expect(getInferenceFacts(accounting)).toBeUndefined()
    expect(getInferenceFacts({ ...accounting })).toBeUndefined()
  })

  it('never revives provenance from a JSON copy or an inherited Symbol', () => {
    const facts = { tokens: { total: 17 }, generatedFields: ['tokens'] }
    const original = withInferenceFacts({ tokens: { total: 17 } }, facts)
    const json = JSON.parse(JSON.stringify(getFailureAccounting(original)))
    expect(getInferenceFacts(getFailureAccounting(json))).toBeUndefined()
    const inherited = Object.create(original)
    expect(getInferenceFacts(getFailureAccounting(inherited))).toBeUndefined()
  })
})
