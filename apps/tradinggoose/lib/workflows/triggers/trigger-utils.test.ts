import { describe, expect, it } from 'vitest'
import type { TriggerOutput } from '@/triggers/types'
import { generateMockPayloadFromOutputsDefinition } from './trigger-utils'

describe('trigger output mock payloads', () => {
  it('recursively follows object properties, including properties named like schema metadata', () => {
    expect(
      generateMockPayloadFromOutputsDefinition({
        result: {
          type: 'object',
          description: 'Not payload data',
          properties: {
            account: { type: 'object', properties: { balance: { type: 'number' } } },
            type: { type: 'string' },
            properties: { type: 'object', properties: { description: { type: 'boolean' } } },
          },
        },
        empty: { type: 'object', properties: {} },
      } satisfies Record<string, TriggerOutput>)
    ).toEqual({
      result: {
        account: { balance: 42 },
        type: 'mock_type',
        properties: { description: true },
      },
      empty: {},
    })
  })

  it('preserves untyped namespaces, generic objects, primitive mocks, and listing identities', () => {
    const genericObject = { id: 'sample_id', name: 'Sample Object', status: 'active' }
    expect(
      generateMockPayloadFromOutputsDefinition({
        namespace: { name: { type: 'string' }, type: { type: 'number' } },
        object: { type: 'object' },
        json: { type: 'json' },
        array: { type: 'array' },
        listing: { type: 'listingIdentity' },
        visualization: { type: 'object' },
      })
    ).toEqual({
      namespace: { name: 'mock_name', type: 42 },
      object: genericObject,
      json: genericObject,
      array: [{ id: 'item_1', name: 'Sample Item', value: 'Sample Value' }],
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
    })
  })

  it('limits recursion through declared object properties', () => {
    const recursive: Record<string, unknown> = { type: 'object' }
    recursive.properties = { child: recursive }
    let current: unknown = generateMockPayloadFromOutputsDefinition({ root: recursive }).root

    for (let depth = 0; depth <= 10; depth++) {
      expect(current).not.toBeNull()
      expect(Object.keys(current as object)).toEqual(['child'])
      current = (current as { child: unknown }).child
    }
    expect(current).toBeNull()
  })
})
