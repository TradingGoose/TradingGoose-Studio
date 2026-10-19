import { describe, expect, it, vi } from 'vitest'
import { convertYamlToWorkflow } from '@/stores/workflows/yaml/importer'

vi.mock('@/blocks', async () => {
  const { LoopBlock } = await import('@/blocks/blocks/loop')
  const { ParallelContainerBlock } = await import('@/blocks/blocks/parallel_container')
  return {
    getBlock: (type: string) =>
      type === 'loop' ? LoopBlock : type === 'parallel' ? ParallelContainerBlock : undefined,
  }
})

describe('container YAML inputs', () => {
  it.each([
    {
      type: 'loop',
      inputs: { loopType: 'forEach', iterations: 7, forEachItems: '[1,2]', whileCondition: '' },
    },
    {
      type: 'parallel',
      inputs: { parallelType: 'collection', count: 3, distribution: '<source.items>' },
    },
  ])('preserves canonical $type inputs with structural data kept separate', ({ type, inputs }) => {
    const result = convertYamlToWorkflow({
      version: '1.0',
      blocks: { container: { type, name: 'Container', inputs } },
    })

    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.blocks[0].inputs).toEqual(inputs)
    expect(result.blocks[0].data).toEqual({ width: 500, height: 300, type: 'subflowNode' })
  })
})
