import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { GetBlockOutputsClientTool } from '@/lib/copilot/tools/client/workflow/get-block-outputs'
import { GetBlockUpstreamReferencesClientTool } from '@/lib/copilot/tools/client/workflow/get-block-upstream-references'

const mockGetReadableWorkflowState = vi.fn()
const originalFetch = globalThis.fetch

vi.mock('@/lib/copilot/tools/client/workflow/workflow-review-tool-utils', () => ({
  getReadableWorkflowState: (...args: unknown[]) => mockGetReadableWorkflowState(...args),
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

describe('workflow output tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals?.()
    globalThis.fetch = originalFetch
    mockGetReadableWorkflowState.mockReset()
  })

  it('get_block_outputs returns structured output entries with paths and types', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    mockGetReadableWorkflowState.mockResolvedValue({
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
      source: 'live',
    })

    const toolCallId = 'get-block-outputs'
    const tool = new GetBlockOutputsClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'get_block_outputs',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.execute({ workflowId: 'wf-1', blockIds: ['agent-1', 'loop-1'] })

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))

    expect(markCompleteBody.data.blocks).toEqual([
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
    expect(
      ToolResultSchemas.get_block_outputs.parse({
        blocks: markCompleteBody.data.blocks,
      })
    ).toBeDefined()
  })

  it('get_block_upstream_references returns structured accessible output entries with paths and types', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    mockGetReadableWorkflowState.mockResolvedValue({
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
      source: 'live',
    })

    const toolCallId = 'get-block-upstream-references'
    const tool = new GetBlockUpstreamReferencesClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'get_block_upstream_references',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.execute({ workflowId: 'wf-1', blockIds: ['fn-1'] })

    expect(tool.getState()).toBe(ClientToolCallState.success)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))

    expect(markCompleteBody.data.results).toEqual([
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
    expect(ToolResultSchemas.get_block_upstream_references.parse(markCompleteBody.data)).toBeDefined()
  })
})
