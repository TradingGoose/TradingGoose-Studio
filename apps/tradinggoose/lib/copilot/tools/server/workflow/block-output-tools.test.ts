import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import { readBlockOutputsServerTool } from '@/lib/copilot/tools/server/workflow/read-block-outputs'
import { readBlockUpstreamReferencesServerTool } from '@/lib/copilot/tools/server/workflow/read-block-upstream-references'

const mockLoadWorkflowSnapshotForCopilot = vi.fn()

vi.mock('@/lib/copilot/tools/server/entities/workflow', () => ({
  loadWorkflowSnapshotForCopilot: (...args: unknown[]) =>
    mockLoadWorkflowSnapshotForCopilot(...args),
}))

vi.mock('@/blocks', () => ({
  getBlock: (blockType: string) => {
    const registry: Record<string, any> = {
      agent: {
        outputs: {
          content: { type: 'string', description: 'Agent content' },
          meta: {
            sentiment: { type: 'string', description: 'Sentiment label' },
          },
        },
      },
      function: {
        outputs: {
          result: { type: 'json', description: 'Return value' },
          stdout: { type: 'string', description: 'Console output' },
        },
      },
      loop: {
        outputs: {},
      },
    }

    return registry[blockType]
  },
}))

describe('server workflow output tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('read_block_outputs returns structured output entries with paths and types', async () => {
    mockLoadWorkflowSnapshotForCopilot.mockResolvedValue({
      workflowId: 'wf-1',
      workflowState: {
        blocks: {
          'agent-1': { id: 'agent-1', type: 'agent', name: 'agent', subBlocks: {} },
          'loop-1': { id: 'loop-1', type: 'loop', name: 'loop', subBlocks: {} },
        },
        edges: [],
        loops: {
          'loop-1': { id: 'loop-1', nodes: [], loopType: 'forEach' },
        },
        parallels: {},
      },
      workspaceId: 'ws-1',
      variables: {
        'var-1': { id: 'var-1', name: 'riskLimit', type: 'number' },
      },
    })

    const result = await readBlockOutputsServerTool.execute(
      { entityId: 'wf-1', blockIds: ['agent-1', 'loop-1'] },
      { userId: 'user-1' }
    )

    expect(result.blocks).toEqual([
      {
        blockId: 'agent-1',
        blockName: 'agent',
        blockType: 'agent',
        outputs: [
          { path: 'agent.content', type: 'string' },
          { path: 'agent.meta.sentiment', type: 'string' },
        ],
      },
      {
        blockId: 'loop-1',
        blockName: 'loop',
        blockType: 'loop',
        outputs: [],
        insideSubflowOutputs: [
          { path: 'loop.index', type: 'number' },
          { path: 'loop.currentItem', type: 'any' },
          { path: 'loop.items', type: 'json' },
        ],
        outsideSubflowOutputs: [{ path: 'loop.results', type: 'json' }],
      },
    ])
    expect(ToolResultSchemas.read_block_outputs.parse(result)).toBeDefined()
    expect(mockLoadWorkflowSnapshotForCopilot).toHaveBeenCalledWith(
      'wf-1',
      { userId: 'user-1' },
      'read'
    )
  })

  it('read_block_upstream_references returns accessible output entries with paths and types', async () => {
    mockLoadWorkflowSnapshotForCopilot.mockResolvedValue({
      workflowId: 'wf-1',
      workflowState: {
        blocks: {
          'agent-1': { id: 'agent-1', type: 'agent', name: 'agent', subBlocks: {} },
          'fn-1': { id: 'fn-1', type: 'function', name: 'function', subBlocks: {} },
        },
        edges: [{ source: 'agent-1', target: 'fn-1' }],
        loops: {},
        parallels: {},
      },
      workspaceId: 'ws-1',
      variables: {
        'var-1': { id: 'var-1', name: 'riskLimit', type: 'number' },
      },
    })

    const result = await readBlockUpstreamReferencesServerTool.execute(
      { entityId: 'wf-1', blockIds: ['fn-1'] },
      { userId: 'user-1' }
    )

    expect(result.results).toEqual([
      {
        blockId: 'fn-1',
        blockName: 'function',
        accessibleBlocks: [
          {
            blockId: 'agent-1',
            blockName: 'agent',
            blockType: 'agent',
            outputs: [
              { path: 'agent.content', type: 'string' },
              { path: 'agent.meta.sentiment', type: 'string' },
            ],
          },
        ],
        variables: [
          {
            id: 'var-1',
            name: 'riskLimit',
            type: 'number',
            tag: 'variable.risklimit',
          },
        ],
      },
    ])
    expect(ToolResultSchemas.read_block_upstream_references.parse(result)).toBeDefined()
  })
})
