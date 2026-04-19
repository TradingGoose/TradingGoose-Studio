import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adaptPreviewPayloadToCanvas } from './preview-payload-adapter'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const mockGetBlock = vi.fn()

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => mockGetBlock(type),
}))

function createWorkflowState(): WorkflowState {
  return {
    blocks: {
      loop_parent: {
        id: 'loop_parent',
        type: 'loop',
        name: 'Loop Parent',
        position: { x: 100, y: 50 },
        subBlocks: {},
        outputs: {} as any,
        enabled: true,
        data: { width: 640, height: 360 },
      },
      agent_inside_loop: {
        id: 'agent_inside_loop',
        type: 'agent',
        name: 'Agent Inside Loop',
        position: { x: 24, y: 16 },
        subBlocks: {
          prompt: {
            id: 'prompt',
            type: 'long-input',
            value: 'trade setup',
          } as any,
        },
        outputs: {} as any,
        enabled: true,
        data: { parentId: 'loop_parent', extent: 'parent' },
      },
      unknown_block: {
        id: 'unknown_block',
        type: 'unknown',
        name: 'Unknown',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {} as any,
        enabled: true,
      },
    },
    edges: [
      {
        id: 'edge-no-type',
        source: 'loop_parent',
        target: 'agent_inside_loop',
      } as any,
      {
        id: 'edge-typed',
        source: 'agent_inside_loop',
        target: 'loop_parent',
        type: 'customEdge',
      } as any,
    ],
    loops: {},
    parallels: {},
  }
}

describe('adaptPreviewPayloadToCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockImplementation((type: string) =>
      type === 'agent'
        ? {
            category: 'blocks',
            subBlocks: [],
            icon: () => null,
          }
        : null
    )
  })

  it('maps loop and regular blocks into canonical read-only preview nodes', () => {
    const workflowState = createWorkflowState()
    const result = adaptPreviewPayloadToCanvas(workflowState)

    expect(result.nodes).toHaveLength(2)

    const loopNode = result.nodes.find((node) => node.id === 'loop_parent')
    expect(loopNode).toMatchObject({
      id: 'loop_parent',
      type: 'subflowNode',
      position: { x: 100, y: 50 },
      data: {
        width: 640,
        height: 360,
        isPreview: true,
        kind: 'loop',
      },
    })

    const agentNode = result.nodes.find((node) => node.id === 'agent_inside_loop')
    expect(agentNode).toMatchObject({
      id: 'agent_inside_loop',
      type: 'previewNode',
      position: { x: 124, y: 66 },
      data: {
        type: 'agent',
        name: 'Agent Inside Loop',
        readOnly: true,
        isPreview: true,
      },
    })
    expect(agentNode?.parentId).toBeUndefined()
    expect(agentNode?.extent).toBeUndefined()
    expect((agentNode as any)?.data?.subBlockValues).toEqual(workflowState.blocks.agent_inside_loop.subBlocks)
  })

  it('skips unsupported block types and defaults missing edge type to workflowEdge', () => {
    const workflowState = createWorkflowState()
    const result = adaptPreviewPayloadToCanvas(workflowState)

    expect(result.nodes.some((node) => node.id === 'unknown_block')).toBe(false)
    expect(result.edges).toEqual([
      expect.objectContaining({
        id: 'edge-no-type',
        type: 'workflowEdge',
      }),
      expect.objectContaining({
        id: 'edge-typed',
        type: 'customEdge',
      }),
    ])
  })

  it('synthesizes stable edge ids when preview payload edges omit them', () => {
    const workflowState = createWorkflowState()
    workflowState.edges = [
      {
        source: 'loop_parent',
        target: 'agent_inside_loop',
      } as any,
    ]

    const result = adaptPreviewPayloadToCanvas(workflowState)

    expect(result.edges).toEqual([
      expect.objectContaining({
        id: 'loop_parent-source-agent_inside_loop-target',
        source: 'loop_parent',
        target: 'agent_inside_loop',
        type: 'workflowEdge',
      }),
    ])
  })

  it('maps diff operations into preview node and subflow statuses', () => {
    const workflowState = createWorkflowState()
    const result = adaptPreviewPayloadToCanvas(workflowState, {
      operations: [
        { operation_type: 'add', block_id: 'agent_inside_loop' },
        { operation_type: 'edit', block_id: 'loop_parent' },
        { operation_type: 'delete', block_id: 'unknown_block' },
      ],
    })

    const loopNode = result.nodes.find((node) => node.id === 'loop_parent')
    expect((loopNode as any)?.data?.diffStatus).toBe('edited')

    const agentNode = result.nodes.find((node) => node.id === 'agent_inside_loop')
    expect((agentNode as any)?.data?.diffStatus).toBe('new')
  })
})
