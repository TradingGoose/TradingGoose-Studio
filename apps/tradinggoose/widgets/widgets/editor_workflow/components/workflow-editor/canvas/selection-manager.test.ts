import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  createNodeIndex,
  deriveEdgesWithSelection,
  getSelectedEdgeInfo,
  getSingleSelectedNodeId,
} from './selection-manager'

describe('selection-manager', () => {
  it('builds node index and resolves selected node id', () => {
    const nodes: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: {}, selected: false },
      { id: 'b', position: { x: 0, y: 0 }, data: {}, selected: true },
    ]

    const nodeIndex = createNodeIndex(nodes)
    expect(nodeIndex.get('a')?.id).toBe('a')
    expect(nodeIndex.get('b')?.id).toBe('b')
    expect(getSingleSelectedNodeId(nodes)).toBe('b')
  })

  it('creates context-aware edge selection info with parent loop id', () => {
    const nodes: Node[] = [
      { id: 'loop', position: { x: 0, y: 0 }, data: {}, selected: false },
      { id: 'source', position: { x: 0, y: 0 }, data: {}, parentId: 'loop', selected: false },
      { id: 'target', position: { x: 0, y: 0 }, data: {}, parentId: 'loop', selected: false },
    ]

    const edge: Edge = {
      id: 'edge-1',
      source: 'source',
      target: 'target',
    }

    const info = getSelectedEdgeInfo(edge, createNodeIndex(nodes))
    expect(info.id).toBe('edge-1')
    expect(info.parentLoopId).toBe('loop')
    expect(info.contextId).toBe('edge-1-loop')
  })

  it('derives edges with selection metadata and forwards onDelete callback', () => {
    const onDelete = vi.fn()

    const nodes: Node[] = [
      { id: 'source', position: { x: 0, y: 0 }, data: {}, parentId: 'loop' },
      { id: 'target', position: { x: 10, y: 10 }, data: {}, parentId: 'loop' },
    ]

    const edges: Edge[] = [
      { id: 'edge-1', source: 'source', target: 'target', data: { tag: 'existing' } },
      { id: 'edge-2', source: 'source', target: 'target' },
    ]

    const derived = deriveEdgesWithSelection({
      edges,
      nodeIndex: createNodeIndex(nodes),
      selectedEdgeInfo: {
        id: 'edge-1',
        parentLoopId: 'loop',
        contextId: 'edge-1-loop',
      },
      onDelete,
    })

    const selectedEdge = derived.find((edge) => edge.id === 'edge-1')
    const unselectedEdge = derived.find((edge) => edge.id === 'edge-2')

    expect(selectedEdge?.data).toMatchObject({
      tag: 'existing',
      isSelected: true,
      isInsideLoop: true,
      parentLoopId: 'loop',
    })
    expect(unselectedEdge?.data).toMatchObject({
      isSelected: false,
      isInsideLoop: true,
      parentLoopId: 'loop',
    })

    ;(selectedEdge?.data as any)?.onDelete('edge-1')
    expect(onDelete).toHaveBeenCalledWith('edge-1')
  })
})
