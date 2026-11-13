import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { RunWorkflowClientTool } from './run-workflow'

const m = vi.hoisted(() => ({
  execute: vi.fn(),
  pending: vi.fn(),
  readback: vi.fn(),
  failure: vi.fn(),
  isExecuting: false,
  setExecuting: vi.fn(),
  abort: new AbortController(),
}))
vi.mock('./workflow-execution-utils', () => ({ executeWorkflowWithFullLogging: m.execute }))
vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: () => ({ isExecuting: m.isExecuting, setIsExecuting: m.setExecuting }),
  },
}))
vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({
      toolCallsById: {},
      currentChat: { workspaceId: null },
      abortController: m.abort,
      readPendingTool: m.pending,
      readbackCopilotToolCall: m.readback,
      recordToolFailure: m.failure,
    }),
  }),
}))
const target = {
  resourceId: '["copilot","personal","actor","actor",null]',
  threadId: 'thread',
  runId: 'run',
  toolCallId: 'call',
  toolName: 'run_workflow',
}
function tool() {
  const instance = new RunWorkflowClientTool('call')
  instance.setExecutionContext({
    toolCallId: 'call',
    toolName: 'run_workflow',
    contextEntityKind: 'workflow',
    contextEntityId: 'live-context',
    workspaceId: 'entity-workspace',
  })
  return instance
}
beforeEach(() => {
  vi.resetAllMocks()
  m.abort = new AbortController()
  m.isExecuting = false
  m.pending.mockResolvedValue({ stage: 'result', target })
  m.execute.mockResolvedValue({ success: true, output: {}, logs: [], metadata: {} })
})
describe('native workflow client explicit scoping', () => {
  it('missing entity never falls back to channel workflow or submits a fabricated result', async () => {
    const instance = tool()
    await instance.execute()
    expect(m.execute).not.toHaveBeenCalled()
    expect(m.setExecuting).not.toHaveBeenCalled()
    expect(m.failure).toHaveBeenCalledWith('call', 'entityId is required')
    expect(m.readback).not.toHaveBeenCalled()
    expect(instance.getState()).toBe(ClientToolCallState.error)
  })
  it('keeps explicit target independent of channel, fresh native scope, original call ID and actual abort signal', async () => {
    const instance = tool()
    await instance.execute({
      entityId: 'explicit-target',
      triggerBlockId: 'schedule-trigger',
      workflow_input: { symbol: 'AAPL' },
    })
    expect(m.pending).toHaveBeenCalledExactlyOnceWith('call')
    expect(m.execute).toHaveBeenCalledExactlyOnceWith({
      native: { workspaceId: null, target },
      signal: m.abort.signal,
      workflowInput: { symbol: 'AAPL' },
      executionId: 'call',
      workflowId: 'explicit-target',
      triggerBlockId: 'schedule-trigger',
    })
    expect(m.readback).toHaveBeenCalledExactlyOnceWith('call', undefined)
    expect(m.execute.mock.invocationCallOrder[0]).toBeLessThan(
      m.readback.mock.invocationCallOrder[0]!
    )
    expect(instance.getState()).toBe(ClientToolCallState.success)
  })
  it('requires native approval stage to complete before any queue request', async () => {
    m.pending.mockResolvedValueOnce({ stage: 'approval', target })
    await tool().execute({ entityId: 'explicit-target', triggerBlockId: 'trigger' })
    expect(m.execute).not.toHaveBeenCalled()
    expect(m.failure).toHaveBeenCalledWith('call', expect.stringContaining('Native approval'))
    expect(m.readback).not.toHaveBeenCalled()
  })
  it('retains actual failed terminal execution through canonical readback instead of a fake status callback', async () => {
    m.execute.mockResolvedValueOnce({
      success: false,
      output: {},
      error: 'Workflow failed',
      logs: [],
    })
    const instance = tool()
    await instance.execute({ entityId: 'explicit-target', triggerBlockId: 'trigger' })
    expect(m.readback).toHaveBeenCalledOnce()
    expect(instance.getState()).toBe(ClientToolCallState.error)
  })
  it('lost proof/readback never repeats the execution effect', async () => {
    m.readback.mockRejectedValueOnce(new Error('Original accepted payload unavailable'))
    const instance = tool()
    await instance.execute({ entityId: 'explicit-target', triggerBlockId: 'trigger' })
    expect(m.execute).toHaveBeenCalledOnce()
    expect(m.failure).toHaveBeenCalledWith('call', 'Original accepted payload unavailable')
    expect(instance.getState()).toBe(ClientToolCallState.error)
  })
  it('preserves existing busy-execution guard before native discovery', async () => {
    m.isExecuting = true
    await tool().execute({ entityId: 'workflow', triggerBlockId: 'trigger' })
    expect(m.pending).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    expect(m.failure).toHaveBeenCalledWith('call', expect.stringContaining('already'))
  })
})
