import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetRegisteredWorkflowSession = vi.fn()

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: unknown[]) => mockGetRegisteredWorkflowSession(...args),
}))

describe('workflow-review-tool-utils', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  it('uses the live Yjs session snapshot when one is registered', async () => {
    const doc = {
      getMap: vi.fn((key: string) => {
        const values: Record<string, unknown> = {
          workflow: new Map([
            ['blocks', { 'block-1': { type: 'agent', name: 'Agent', subBlocks: {}, outputs: {} } }],
            ['edges', []],
            ['loops', {}],
            ['parallels', {}],
          ]),
          textFields: new Map(),
        }
        return values[key]
      }),
    }

    mockGetRegisteredWorkflowSession.mockReturnValue({
      workflowId: 'workflow-live',
      doc,
    })

    const { getReadableWorkflowSnapshot } = await import('./workflow-review-tool-utils')
    const result = await getReadableWorkflowSnapshot({
      toolCallId: 'tool-1',
      toolName: 'get_user_workflow',
      channelId: 'channel-1',
      workflowId: 'workflow-live',
    })

    expect(result.source).toBe('live')
    expect(result.workflowId).toBe('workflow-live')
    expect(result.workflowState.blocks['block-1']).toMatchObject({
      type: 'agent',
      name: 'Agent',
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('falls back to the workflow API when no live Yjs session is registered', async () => {
    mockGetRegisteredWorkflowSession.mockReturnValue(null)
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          state: {
            blocks: { 'block-1': { type: 'agent', name: 'Agent', subBlocks: {}, outputs: {} } },
            edges: [],
            loops: {},
            parallels: {},
            lastSaved: '2026-04-05T23:42:00.000Z',
          },
        },
      }),
    } as Response)

    const { getReadableWorkflowSnapshot } = await import('./workflow-review-tool-utils')
    const result = await getReadableWorkflowSnapshot({
      toolCallId: 'tool-1',
      toolName: 'get_user_workflow',
      channelId: 'channel-1',
      workflowId: 'workflow-db',
    })

    expect(result.source).toBe('db')
    expect(result.workflowId).toBe('workflow-db')
    expect(global.fetch).toHaveBeenCalledWith('/api/workflows/workflow-db', {
      method: 'GET',
    })
    expect(result.workflowState.blocks['block-1']).toMatchObject({
      type: 'agent',
      name: 'Agent',
    })
  })
})
