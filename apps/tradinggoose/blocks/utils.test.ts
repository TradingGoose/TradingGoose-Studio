import { describe, expect, it } from 'vitest'
import { resolveOutputType } from './utils'

describe('resolveOutputType', () => {
  it('preserves nested object fields in the runtime output type map', () => {
    expect(
      resolveOutputType({
        payload: {
          type: 'object',
          description: 'Schema metadata, not an output field',
          properties: {
            type: { type: 'string' },
            properties: {
              type: 'object',
              properties: { count: { type: 'number' } },
            },
            snapshot: { type: 'object' },
          },
        },
        empty: { type: 'object', properties: {} },
      })
    ).toEqual({
      payload: { type: 'string', properties: { count: 'number' }, snapshot: 'object' },
      empty: {},
    })
  })

  it('keeps primitive, file, and opaque object outputs unchanged', () => {
    expect(
      resolveOutputType({
        text: 'string',
        count: { type: 'number', description: 'Count' },
        data: { type: 'json' },
        opaque: { type: 'object' },
        files: { type: 'files' },
        listing: { type: 'listingIdentity' },
      })
    ).toEqual({
      text: 'string',
      count: 'number',
      data: 'json',
      opaque: 'object',
      files: 'files',
      listing: 'listingIdentity',
    })
  })
})
