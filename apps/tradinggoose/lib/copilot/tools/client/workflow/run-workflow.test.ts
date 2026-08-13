import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'

const mockExecuteWorkflowWithFullLogging = vi.fn()

const mockExecutionState = {
  isExecuting: false,
  setIsExecuting: vi.fn((isExecuting: boolean) => {
    mockExecutionState.isExecuting = isExecuting
  }),
}

vi.mock('@/lib/copilot/tools/client/workflow/workflow-execution-utils', () => ({
  executeWorkflowWithFullLogging: (options: Record<string, any>) =>
    mockExecuteWorkflowWithFullLogging(options),
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: () => mockExecutionState,
  },
}))

vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({ toolCallsById: {} }),
  }),
}))

describe('RunWorkflowClientTool channel-safe workflow scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals?.()
    mockExecutionState.isExecuting = false
    mockExecutionState.setIsExecuting.mockClear()
    mockExecuteWorkflowWithFullLogging.mockReset()
    mockExecuteWorkflowWithFullLogging.mockResolvedValue({
      success: true,
      output: {},
      logs: [],
      metadata: {},
    })
  })

  it('handleAccept rejects missing entityId even when execution context has a workflow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const toolCallId = 'run-workflow-tool-call'
    const tool = new RunWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'run_workflow',
      contextEntityKind: 'workflow',
      contextEntityId: 'wf-context',
      log: vi.fn(),
    })

    await tool.handleAccept({ workflow_input: 'execute this' } as any)

    expect(mockExecuteWorkflowWithFullLogging).not.toHaveBeenCalled()
    expect(mockExecutionState.setIsExecuting).not.toHaveBeenCalled()
    expect(tool.getState()).toBe(ClientToolCallState.error)

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.status).toBe(400)
    expect(markCompleteBody.message).toContain('entityId is required')
  })

  it('handleAccept preserves an explicit workflow target instead of reusing the live channel workflow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const toolCallId = 'run-workflow-explicit-target'
    const tool = new RunWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'run_workflow',
      contextEntityKind: 'workflow',
      contextEntityId: 'wf-live-context',
      log: vi.fn(),
    })

    await tool.handleAccept({
      entityId: 'wf-explicit-target',
      triggerBlockId: 'schedule-trigger',
      workflow_input: { symbol: 'AAPL' },
    })

    expect(mockExecuteWorkflowWithFullLogging).toHaveBeenCalledWith({
      workflowInput: { symbol: 'AAPL' },
      executionId: toolCallId,
      workflowId: 'wf-explicit-target',
      triggerBlockId: 'schedule-trigger',
    })
    expect(tool.getState()).toBe(ClientToolCallState.success)
  })

  it('preserves public deadline diagnostics in the failed tool result', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    mockExecuteWorkflowWithFullLogging.mockResolvedValueOnce({
      success: false,
      output: {},
      error: 'persisted English deadline error',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      deadline: {
        appliedTierId: 'tier-pro',
        appliedTierName: 'Pro',
        limitSeconds: 20,
        processingStartedAt: '2026-08-07T15:16:14.200Z',
        terminatedAt: '2026-08-07T15:16:34.200Z',
      },
      logs: [{ blockId: 'wait-1' }],
    })

    const tool = new RunWorkflowClientTool('run-workflow-deadline')
    await tool.handleAccept({
      entityId: 'wf-target',
      triggerBlockId: 'manual-trigger',
    })

    expect(tool.getState()).toBe(ClientToolCallState.error)
    const markCompleteBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(markCompleteBody.data).toMatchObject({
      success: false,
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      deadline: { appliedTierName: 'Pro', limitSeconds: 20 },
    })
    expect(markCompleteBody.data).not.toHaveProperty('logs')
  })
})
