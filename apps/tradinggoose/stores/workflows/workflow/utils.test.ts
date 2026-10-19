import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  buildExecutableWorkflowData,
  convertLoopBlockToLoop,
  convertParallelBlockToParallel,
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

const configuredBlock = (id: string, type: string, values: Record<string, any>) =>
  block(id, type, {
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, { id: key, type: 'short-input', value }])
    ),
  })

describe('convertLoopBlockToLoop', () => {
  it.concurrent.each([
    ['["item1", "item2"]', ['item1', 'item2']],
    ['{"key1": "value1"}', { key1: 'value1' }],
    ['<blockName.items>', '<blockName.items>'],
    ['', ''],
    [
      [1, 2],
      [1, 2],
    ],
    [{ key: 'value' }, { key: 'value' }],
  ])('reads the canonical collection value %j', (forEachItems, expected) => {
    const blocks = {
      loop1: configuredBlock('loop1', 'loop', {
        loopType: 'forEach',
        iterations: '10',
        forEachItems,
      }),
      child: block('child', 'function', { data: { parentId: 'loop1' } }),
    }

    expect(convertLoopBlockToLoop('loop1', blocks)).toEqual({
      id: 'loop1',
      nodes: ['child'],
      iterations: 10,
      loopType: 'forEach',
      forEachItems: expected,
    })
  })

  it.concurrent.each(['while', 'doWhile'])(
    'reads %s condition from its canonical sub-block',
    (loopType) => {
      const blocks = {
        loop1: configuredBlock('loop1', 'loop', {
          loopType,
          iterations: 8,
          forEachItems: '["inactive"]',
          whileCondition: '<counter.value> < 3',
        }),
      }

      expect(convertLoopBlockToLoop('loop1', blocks)).toEqual({
        id: 'loop1',
        nodes: [],
        iterations: 8,
        loopType,
        whileCondition: '<counter.value> < 3',
      })
    }
  )

  it.concurrent('uses numeric-mode defaults and preserves the inactive collection', () => {
    const blocks = {
      loop1: configuredBlock('loop1', 'loop', { forEachItems: '["retained"]' }),
    }

    expect(convertLoopBlockToLoop('loop1', blocks)).toMatchObject({
      loopType: 'for',
      iterations: 5,
      forEachItems: ['retained'],
    })
  })
})

describe('convertParallelBlockToParallel', () => {
  it.concurrent('reads count and direct child membership from canonical values', () => {
    const blocks = {
      parallel1: configuredBlock('parallel1', 'parallel', {
        parallelType: 'count',
        count: '12',
        distribution: '["inactive"]',
      }),
      child: block('child', 'function', { data: { parentId: 'parallel1' } }),
    }

    expect(convertParallelBlockToParallel('parallel1', blocks)).toEqual({
      id: 'parallel1',
      nodes: ['child'],
      parallelType: 'count',
      count: 12,
      distribution: '',
    })
  })

  it.concurrent.each(
    ['<source.items>', '[1,2]', [1, 2], { item: 1 }, ''].map((distribution) => ({ distribution }))
  )(
    'preserves collection-mode distribution $distribution for runtime evaluation',
    ({ distribution }) => {
      const blocks = {
        parallel1: configuredBlock('parallel1', 'parallel', {
          parallelType: 'collection',
          distribution,
        }),
      }

      expect(convertParallelBlockToParallel('parallel1', blocks)).toMatchObject({
        parallelType: 'collection',
        count: 5,
        distribution,
      })
    }
  )

  it.concurrent('uses count-mode defaults', () => {
    expect(
      convertParallelBlockToParallel('parallel1', { parallel1: block('parallel1', 'parallel') })
    ).toMatchObject({ parallelType: 'count', count: 5, distribution: '' })
  })
})
