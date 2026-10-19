import { describe, expect, it } from 'vitest'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
import type { BlockState } from '@/stores/workflows/workflow/types'

describe('container workflow sanitization', () => {
  it.each([
    {
      type: 'loop',
      values: {
        loopType: 'while',
        iterations: 5,
        forEachItems: '[1,2]',
        whileCondition: '<counter.value> < 3',
      },
    },
    {
      type: 'parallel',
      values: { parallelType: 'collection', count: 4, distribution: '<source.items>' },
    },
  ])('reads canonical $type inputs through standard sub-block sanitization', ({ type, values }) => {
    const container: BlockState = {
      id: 'container',
      type,
      name: 'Container',
      position: { x: 0, y: 0 },
      subBlocks: Object.fromEntries(
        Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
      ),
      outputs: {},
      enabled: true,
    }
    const result = sanitizeForCopilot({
      blocks: { container },
      edges: [],
      loops: {},
      parallels: {},
    })

    expect(result.blocks.container.inputs).toEqual(values)
  })
})
