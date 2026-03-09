import { describe, expect, it } from 'vitest'
import type { Edge } from 'reactflow'
import { deriveCanvasEdges } from './derive-canvas-edges'

describe('derive-canvas-edges', () => {
  it('returns original edges when diff reconstruction is not applicable', () => {
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'a',
        target: 'b',
      },
    ]

    expect(
      deriveCanvasEdges({
        edges,
        isShowingDiff: true,
        isDiffReady: true,
        diffAnalysis: {
          edge_diff: {
            deleted_edges: ['a-source-b-target'],
          },
        },
        blocks: { a: {}, b: {} },
      })
    ).toBe(edges)

    expect(
      deriveCanvasEdges({
        edges,
        isShowingDiff: false,
        isDiffReady: false,
        diffAnalysis: {
          edge_diff: {
            deleted_edges: ['a-source-b-target'],
          },
        },
        blocks: { a: {}, b: {} },
      })
    ).toBe(edges)
  })

  it('reconstructs deleted edges only for valid identifiers with existing blocks', () => {
    const edges: Edge[] = [
      {
        id: 'edge-live',
        source: 'live-a',
        target: 'live-b',
      },
    ]

    const result = deriveCanvasEdges({
      edges,
      isShowingDiff: false,
      isDiffReady: true,
      diffAnalysis: {
        edge_diff: {
          deleted_edges: [
            'src-source-tgt-target',
            'missing-source-tgt-target',
            'bad-format',
          ],
        },
      },
      blocks: {
        src: {},
        tgt: {},
      },
    })

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('edge-live')
    expect(result[1]).toMatchObject({
      id: 'deleted-src-source-tgt-target',
      source: 'src',
      target: 'tgt',
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'workflowEdge',
      data: {
        isDeleted: true,
      },
    })
  })

  it('supports identifiers with hyphenated node ids', () => {
    const result = deriveCanvasEdges({
      edges: [],
      isShowingDiff: false,
      isDiffReady: true,
      diffAnalysis: {
        edge_diff: {
          deleted_edges: ['source-node-source-target-node-target'],
        },
      },
      blocks: {
        'source-node': {},
        'target-node': {},
      },
    })

    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('source-node')
    expect(result[0].target).toBe('target-node')
  })
})
