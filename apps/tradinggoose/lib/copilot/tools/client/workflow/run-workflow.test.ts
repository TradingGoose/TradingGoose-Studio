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

describe('RunWorkflowClientTool channel-safe workflow scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('handleAccept uses execution-context workflow and channel when args.workflowId is omitted', async () => {
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
      channelId: 'pair-green',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.handleAccept({ workflow_input: 'execute this' })

    expect(mockExecuteWorkflowWithFullLogging).toHaveBeenCalledWith({
      workflowInput: { input: 'execute this' },
      executionId: toolCallId,
      channelId: 'pair-green',
    })
    expect(mockExecutionState.setIsExecuting).toHaveBeenNthCalledWith(1, true)
    expect(mockExecutionState.setIsExecuting).toHaveBeenLastCalledWith(false)
    expect(tool.getState()).toBe(ClientToolCallState.success)
  })
})
