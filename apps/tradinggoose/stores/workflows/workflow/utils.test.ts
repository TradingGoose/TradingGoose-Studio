import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  buildExecutableWorkflowData,
  convertLoopBlockToLoop,
} from '@/stores/workflows/workflow/utils'

const block = (id: string, type = 'agent', extra: Partial<BlockState> = {}): BlockState => ({
  id,
  type,
  name: id,
  position: { x: 0, y: 0 },
  subBlocks: {},
  outputs: {},
  enabled: true,
  ...extra,
})

describe('buildExecutableWorkflowData', () => {
  it.concurrent('keeps blocks, edges, loops, and parallels consistent with enabled blocks', () => {
    const blocks: Record<string, BlockState> = {
      trigger: block('trigger', 'manual_trigger'),
      loop: block('loop', 'loop'),
      parallel: block('parallel', 'parallel'),
      active: block('active', 'agent', { data: { parentId: 'loop' } }),
      disabled: block('disabled', 'agent', { enabled: false, data: { parentId: 'parallel' } }),
    }

    const result = buildExecutableWorkflowData(blocks, [
      { id: 'edge-1', source: 'trigger', target: 'active' },
      { id: 'edge-2', source: 'active', target: 'disabled' },
      { id: 'edge-3', source: 'disabled', target: 'parallel' },
    ])

    expect(Object.keys(result.blocks).sort()).toEqual(['active', 'loop', 'parallel', 'trigger'])
    expect(result.edges).toEqual([{ id: 'edge-1', source: 'trigger', target: 'active' }])
    expect(result.loops.loop.nodes).toEqual(['active'])
    expect(result.parallels.parallel.nodes).toEqual([])
  })
})

describe('convertLoopBlockToLoop', () => {
  it.concurrent('should parse JSON array string for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 10,
          collection: '["item1", "item2", "item3"]',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('forEach')
    expect(result?.forEachItems).toEqual(['item1', 'item2', 'item3'])
    expect(result?.iterations).toBe(10)
  })

  it.concurrent('should parse JSON object string for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 5,
          collection: '{"key1": "value1", "key2": "value2"}',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('forEach')
    expect(result?.forEachItems).toEqual({ key1: 'value1', key2: 'value2' })
  })

  it.concurrent('should keep string as-is if not valid JSON', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 5,
          collection: '<blockName.items>',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('<blockName.items>')
  })

  it.concurrent('should handle empty collection', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 5,
          collection: '',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('')
  })

  it.concurrent('should handle for loops without collection parsing', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'for',
          count: 5,
          collection: '["should", "not", "matter"]',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('for')
    expect(result?.iterations).toBe(5)
    // For 'for' loops, the collection is still parsed in case it's later changed to forEach
    expect(result?.forEachItems).toEqual(['should', 'not', 'matter'])
  })
})
