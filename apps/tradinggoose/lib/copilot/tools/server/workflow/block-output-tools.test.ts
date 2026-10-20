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
          structured: {
            type: 'object',
            properties: {
              count: { type: 'number' },
            },
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
          'loop-1': { id: 'loop-1', type: 'loop', name: 'Research Loop', subBlocks: {} },
          'parallel-1': {
            id: 'parallel-1',
            type: 'parallel',
            name: 'Research Parallel',
            subBlocks: {},
          },
        },
        edges: [],
        loops: {
          'loop-1': { id: 'loop-1', nodes: [], loopType: 'forEach' },
        },
        parallels: {
          'parallel-1': { id: 'parallel-1', nodes: [], parallelType: 'collection' },
        },
      },
      workspaceId: 'ws-1',
      variables: {
        'var-1': { id: 'var-1', name: 'riskLimit', type: 'number' },
      },
    })

    const result = await readBlockOutputsServerTool.execute(
      { entityId: 'wf-1', blockIds: ['agent-1', 'loop-1', 'parallel-1'] },
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
          { path: 'agent.structured', type: 'object' },
          { path: 'agent.structured.count', type: 'number' },
        ],
      },
      {
        blockId: 'loop-1',
        blockName: 'Research Loop',
        blockType: 'loop',
        outputs: [],
        insideSubflowOutputs: [
          { path: 'loop.index', type: 'number' },
          { path: 'loop.currentItem', type: 'any' },
          { path: 'loop.items', type: 'json' },
        ],
        outsideSubflowOutputs: [{ path: 'researchloop.results', type: 'json' }],
      },
      {
        blockId: 'parallel-1',
        blockName: 'Research Parallel',
        blockType: 'parallel',
        outputs: [],
        insideSubflowOutputs: [
          { path: 'parallel.index', type: 'number' },
          { path: 'parallel.currentItem', type: 'any' },
          { path: 'parallel.items', type: 'json' },
        ],
        outsideSubflowOutputs: [{ path: 'researchparallel.results', type: 'json' }],
      },
    ])
    expect(ToolResultSchemas.read_block_outputs.parse(result)).toBeDefined()
    expect(mockLoadWorkflowSnapshotForCopilot).toHaveBeenCalledWith(
      'wf-1',
      { userId: 'user-1' },
      'read'
    )
  })

  it.each(['while', 'doWhile', 'forEach'])(
    'read_block_upstream_references uses the active %s loop scope',
    async (mode) => {
      mockLoadWorkflowSnapshotForCopilot.mockResolvedValue({
        workflowState: {
          blocks: {
            outer: { id: 'outer', type: 'loop', name: 'Outer Loop' },
            inner: { id: 'inner', type: 'loop', name: 'Inner Loop' },
          },
          edges: [{ source: 'outer', target: 'inner' }],
          loops: {
            outer: { id: 'outer', nodes: ['inner'], loopType: 'forEach' },
            inner: { id: 'inner', nodes: [], loopType: mode },
          },
          parallels: {},
        },
      })
      const result = await readBlockUpstreamReferencesServerTool.execute(
        { entityId: 'wf-1', blockIds: ['inner'] },
        { userId: 'user-1' }
      )
      expect(result.results[0].accessibleBlocks).toEqual([
        {
          blockId: mode === 'forEach' ? 'outer' : 'inner',
          blockName: mode === 'forEach' ? 'Outer Loop' : 'Inner Loop',
          blockType: 'loop',
          accessContext: 'inside',
          outputs: [
            { path: 'loop.index', type: 'number' },
            ...(mode === 'forEach'
              ? [
                  { path: 'loop.currentItem', type: 'any' },
                  { path: 'loop.items', type: 'json' },
                ]
              : []),
          ],
        },
      ])
    }
  )

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
              { path: 'agent.structured', type: 'object' },
              { path: 'agent.structured.count', type: 'number' },
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
