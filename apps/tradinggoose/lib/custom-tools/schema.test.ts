import { describe, expect, it } from 'vitest'
import { CustomToolOpenAiSchema } from '@/lib/custom-tools/schema'

describe('custom tool schema', () => {
  it('requires function parameters to be an object schema', () => {
    expect(() =>
      CustomToolOpenAiSchema.parse({
        type: 'function',
        function: {
          name: 'searchNews',
          parameters: {
            type: 'string',
            properties: {},
          },
        },
      })
    ).toThrow()
  })
})
