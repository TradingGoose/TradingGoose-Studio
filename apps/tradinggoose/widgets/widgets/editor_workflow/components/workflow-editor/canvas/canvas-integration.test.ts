import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { resolveCanvasNodeDescriptor } from './block-registry'
import { createConnectionEdge } from './connection-manager'
import { deriveCanvasNodes } from './derive-canvas-nodes'
import { updateNodeParentForCanvas } from './parenting-manager'

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

describe('canvas integration sequence', () => {
  it('supports load -> render -> drag -> connect flow across extracted managers', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createBlock({
        id: 'loop1',
        type: 'loop',
        name: 'Loop',
        position: { x: 300, y: 120 },
        data: { width: 500, height: 300 },
      }),
      source1: createBlock({
        id: 'source1',
        type: 'agent',
        name: 'Source',
        position: { x: 120, y: 80 },
        data: {},
      }),
      target1: createBlock({
        id: 'target1',
        type: 'condition',
        name: 'Target',
        position: { x: 420, y: 260 },
        data: {},
      }),
    }

    const resolveBlockConfig = (type: string) => {
      if (type === 'agent' || type === 'condition') {
        return { category: 'blocks' } as any
      }
      return undefined
    }

    let nodes = deriveCanvasNodes({
      blocks,
      activeBlockIds: new Set(),
      pendingBlocks: [],
      isDebugging: false,
      nestedSubflowErrors: new Set(),
      resolveBlockConfig,
      resolveNodeDescriptor: resolveCanvasNodeDescriptor,
    }) as Node[]

    expect(nodes.map((node) => node.id)).toEqual(['loop1', 'source1', 'target1'])

    const updateBlockPosition = vi.fn((id: string, position: { x: number; y: number }) => {
      blocks[id].position = position
      const node = nodes.find((n) => n.id === id)
      if (node) {
        node.position = position
      }
    })

    const updateParentId = vi.fn((id: string, parentId: string) => {
      blocks[id].data = parentId ? { ...(blocks[id].data ?? {}), parentId, extent: 'parent' } : {}
      const node = nodes.find((n) => n.id === id)
      if (node) {
        node.parentId = parentId || undefined
      }
    })

    const updateNodeDimensions = vi.fn(
      (id: string, dimensions: { width: number; height: number }) => {
        blocks[id].data = {
          ...(blocks[id].data ?? {}),
          width: dimensions.width,
          height: dimensions.height,
        }

        const node = nodes.find((n) => n.id === id)
        if (node) {
          node.data = {
            ...(node.data as any),
            width: dimensions.width,
            height: dimensions.height,
          }
        }
      }
    )

    const parentUpdate = updateNodeParentForCanvas({
      nodeId: 'target1',
      newParentId: 'loop1',
      blocks,
      getNodes: () => nodes,
      edgesForDisplay: [],
      updateBlockPosition,
      updateParentId: updateParentId as any,
      updateNodeDimensions,
    })

    expect(parentUpdate?.changed).toBe(true)
    expect(parentUpdate?.newParentId).toBe('loop1')
    expect(blocks.target1.data?.parentId).toBe('loop1')

    nodes = deriveCanvasNodes({
      blocks,
      activeBlockIds: new Set(),
      pendingBlocks: [],
      isDebugging: false,
      nestedSubflowErrors: new Set(),
      resolveBlockConfig,
      resolveNodeDescriptor: resolveCanvasNodeDescriptor,
    }) as Node[]

    const edge = createConnectionEdge({
      connection: {
        source: 'loop1',
        sourceHandle: 'loop-start-source',
        target: 'target1',
        targetHandle: 'target',
      },
      nodes,
      blocks,
      createEdgeId: () => 'edge-loop-target',
    })

    expect(edge).toMatchObject({
      id: 'edge-loop-target',
      source: 'loop1',
      target: 'target1',
      type: 'workflowEdge',
      data: {
        parentId: 'loop1',
        isInsideContainer: true,
      },
    })

    const internalEndEdge = createConnectionEdge({
      connection: {
        source: 'target1',
        sourceHandle: 'source',
        target: 'loop1',
        targetHandle: 'loop-end-target',
      },
      nodes,
      blocks,
      createEdgeId: () => 'edge-target-loop-end',
    })

    expect(internalEndEdge).toMatchObject({
      id: 'edge-target-loop-end',
      source: 'target1',
      target: 'loop1',
      targetHandle: 'loop-end-target',
      type: 'workflowEdge',
      data: {
        parentId: 'loop1',
        isInsideContainer: true,
      },
    })
  })
})
