import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { SetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-global-workflow-variables'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const mockGetRegisteredWorkflowSession = vi.fn()
const mockGetVariablesForWorkflow = vi.fn()
const mockSetVariables = vi.fn()

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: any[]) => mockGetRegisteredWorkflowSession(...args),
  getVariablesForWorkflow: (...args: any[]) => mockGetVariablesForWorkflow(...args),
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  getVariablesMap: vi.fn(),
  setVariables: (...args: any[]) => mockSetVariables(...args),
}))

describe('SetGlobalWorkflowVariablesClientTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals?.()
    mockGetRegisteredWorkflowSession.mockReset()
    mockGetVariablesForWorkflow.mockReset()
    mockSetVariables.mockReset()
  })

  it('uses explicit workflowId and writes variables only through the live Yjs session', async () => {
    const doc = { kind: 'workflow-doc' }
    mockGetRegisteredWorkflowSession.mockReturnValue({ doc })
    mockGetVariablesForWorkflow.mockReturnValue({
      'var-1': {
        id: 'var-1',
        workflowId: 'wf-target',
        name: 'existing',
        type: 'plain',
        value: 'value',
      },
    })

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'var-2'),
    })

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

    const toolCallId = 'set-vars-tool-call'
    const tool = new SetGlobalWorkflowVariablesClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'set_global_workflow_variables',
      channelId: 'pair-purple',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.handleAccept({
      workflowId: 'wf-target',
      operations: [
        { operation: 'edit', name: 'existing', type: 'number', value: '42' },
        { operation: 'add', name: 'newVar', type: 'boolean', value: 'true' },
      ],
    })

    expect(mockGetRegisteredWorkflowSession).toHaveBeenCalledWith('wf-target')
    expect(mockGetVariablesForWorkflow).toHaveBeenCalledWith('wf-target')
    expect(mockSetVariables).toHaveBeenCalledTimes(1)
    expect(mockSetVariables).toHaveBeenCalledWith(
      doc,
      {
        'var-1': {
          id: 'var-1',
          workflowId: 'wf-target',
          name: 'existing',
          type: 'number',
          value: 42,
        },
        'var-2': {
          id: 'var-2',
          workflowId: 'wf-target',
          name: 'newVar',
          type: 'boolean',
          value: true,
        },
      },
      YJS_ORIGINS.COPILOT_TOOL
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/tools/mark-complete',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(tool.getState()).toBe(ClientToolCallState.success)
  })
})
