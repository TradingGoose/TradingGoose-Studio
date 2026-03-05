import { describe, expect, it, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { resolveCanvasNodeDescriptor } from './block-registry'
import { deriveCanvasNodes, getStableBlocksHash } from './derive-canvas-nodes'

function createBlock(
  overrides: Partial<BlockState> & Pick<BlockState, 'id' | 'type' | 'name'>
): BlockState {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    subBlocks: overrides.subBlocks ?? {},
    outputs: overrides.outputs ?? ({} as any),
    enabled: overrides.enabled ?? true,
    horizontalHandles: overrides.horizontalHandles,
    isWide: overrides.isWide,
    height: overrides.height,
    advancedMode: overrides.advancedMode,
    triggerMode: overrides.triggerMode,
    data: overrides.data,
    layout: overrides.layout,
  }
}

describe('derive-canvas-nodes', () => {
  it('derives workflow and container nodes with expected properties', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createBlock({
        id: 'loop1',
        type: 'loop',
        name: 'Loop',
        position: { x: 100, y: 120 },
        data: { width: 640, height: 380 },
      }),
      agent1: createBlock({
        id: 'agent1',
        type: 'agent',
        name: 'Agent',
        position: { x: 20, y: 40 },
        isWide: true,
        height: 180,
        data: { parentId: 'loop1', extent: 'parent' },
      }),
    }

    const nodes = deriveCanvasNodes({
      blocks,
      activeBlockIds: new Set(['agent1']),
      pendingBlocks: ['agent1'],
      isDebugging: true,
      nestedSubflowErrors: new Set(['loop1']),
      resolveBlockConfig: (type) =>
        type === 'agent' ? ({ category: 'blocks' } as any) : undefined,
      resolveNodeDescriptor: resolveCanvasNodeDescriptor,
    })

    expect(nodes).toHaveLength(2)

    const loopNode = nodes.find((node) => node.id === 'loop1')
    expect(loopNode?.type).toBe('subflowNode')
    expect(loopNode?.data?.kind).toBe('loop')
    expect(loopNode?.data?.hasNestedError).toBe(true)
    expect(loopNode?.data?.width).toBe(640)

    const agentNode = nodes.find((node) => node.id === 'agent1')
    expect(agentNode?.type).toBe('workflowBlock')
    expect(agentNode?.parentId).toBe('loop1')
    expect(agentNode?.data?.isActive).toBe(true)
    expect(agentNode?.data?.isPending).toBe(true)
    expect(agentNode?.width).toBe(350)
    expect(agentNode?.height).toBe(180)
  })

  it('skips unknown block configs and calls missing-config callback', () => {
    const missingConfig = vi.fn()
    const blocks: Record<string, BlockState> = {
      unknown1: createBlock({ id: 'unknown1', type: 'unknown', name: 'Unknown' }),
    }

    const nodes = deriveCanvasNodes({
      blocks,
      activeBlockIds: new Set(),
      pendingBlocks: [],
      isDebugging: false,
      nestedSubflowErrors: new Set(),
      resolveBlockConfig: () => undefined,
      resolveNodeDescriptor: resolveCanvasNodeDescriptor,
      onMissingBlockConfig: missingConfig,
    })

    expect(nodes).toHaveLength(0)
    expect(missingConfig).toHaveBeenCalledTimes(1)
    expect(missingConfig).toHaveBeenCalledWith(blocks.unknown1)
  })

  it('keeps stable hash when block object reference is unchanged', () => {
    const blocks: Record<string, BlockState> = {
      agent1: createBlock({ id: 'agent1', type: 'agent', name: 'Agent', position: { x: 1, y: 2 } }),
    }

    const prevBlocksRef = { current: blocks }
    const prevHashRef = { current: 'cached-hash' }

    const sameRefHash = getStableBlocksHash(blocks, prevBlocksRef, prevHashRef)
    expect(sameRefHash).toBe('cached-hash')

    const nextBlocks = {
      ...blocks,
      agent1: {
        ...blocks.agent1,
        position: { x: 11, y: 22 },
      },
    }

    const nextHash = getStableBlocksHash(nextBlocks, prevBlocksRef, prevHashRef)
    expect(nextHash).not.toBe('cached-hash')
    expect(prevBlocksRef.current).toBe(nextBlocks)
    expect(prevHashRef.current).toBe(nextHash)
  })
})
