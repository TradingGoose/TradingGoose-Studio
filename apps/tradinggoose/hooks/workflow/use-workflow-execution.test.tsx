/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRunQueuedWorkflowExecution = vi.hoisted(() => vi.fn())
const mockUseCurrentWorkflow = vi.hoisted(() => vi.fn())
const mockUseWorkflowVariables = vi.hoisted(() => vi.fn())

const mockConsoleState = vi.hoisted(() => ({
  cancelRunningEntries: vi.fn(),
  addConsole: vi.fn(),
  ingestWorkflowExecutionEvent: vi.fn(),
  updateConsole: vi.fn(),
  entries: [],
}))

const mockExecutionState = vi.hoisted(() => ({
  isExecuting: false,
  setIsExecuting: vi.fn(),
  setIsDebugging: vi.fn(),
  setPendingBlocks: vi.fn(),
  setActiveBlocks: vi.fn(),
  activeBlockIds: new Set<string>(),
}))

vi.mock('@/lib/workflows/queued-execution-client', () => ({
  runQueuedWorkflowExecution: mockRunQueuedWorkflowExecution,
}))

vi.mock('@/lib/workflows/triggers', () => ({
  TriggerUtils: {
    findStartBlock: vi.fn(() => ({ blockId: 'chat-trigger', block: {} })),
    getTriggerValidationMessage: vi.fn(() => 'Missing chat trigger'),
    findTriggersByType: vi.fn((blocks, type) =>
      type === 'manual'
        ? Object.values(blocks as Record<string, any>).filter(
            (block: any) => block.type === 'manual_trigger'
          )
        : []
    ),
  },
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowVariables: mockUseWorkflowVariables,
}))

vi.mock('@/stores/console/store', () => {
  const useConsoleStore = vi.fn(() => mockConsoleState)
  return {
    useConsoleStore: Object.assign(useConsoleStore, {
      getState: vi.fn(() => mockConsoleState),
    }),
  }
})

vi.mock('@/stores/execution/store', () => {
  const useExecutionStore = vi.fn(() => mockExecutionState)
  return {
    useExecutionStore: Object.assign(useExecutionStore, {
      getState: vi.fn(() => mockExecutionState),
    }),
  }
})

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: vi.fn((selector) =>
    selector({
      workflows: {
        'workflow-1': {
          workspaceId: 'workspace-1',
        },
      },
      getActiveWorkflowId: () => null,
    })
  ),
}))

vi.mock('@/stores/workflows/workflow/utils', () => ({
  generateLoopBlocks: vi.fn(() => ({})),
  generateParallelBlocks: vi.fn(() => ({})),
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkflowRoute: vi.fn(() => ({
    workflowId: 'workflow-1',
    channelId: 'channel-1',
  })),
}))

vi.mock('./use-current-workflow', () => ({
  useCurrentWorkflow: mockUseCurrentWorkflow,
}))

describe('useWorkflowExecution', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

  async function renderExecutionHook() {
    const { useWorkflowExecution } = await import('./use-workflow-execution')
    const state: { execution: ReturnType<typeof useWorkflowExecution> | null } = {
      execution: null,
    }

    function Harness() {
      state.execution = useWorkflowExecution()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    if (!state.execution) throw new Error('useWorkflowExecution did not render')
    return state.execution
  }

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockRunQueuedWorkflowExecution.mockResolvedValue({
      success: true,
      output: {},
      logs: [],
    })
    mockUseWorkflowVariables.mockReturnValue([])
    mockUseCurrentWorkflow.mockReturnValue({
      blocks: {
        'chat-trigger': {
          id: 'chat-trigger',
          type: 'chat_trigger',
          name: 'Chat Trigger',
          enabled: true,
          subBlocks: {},
          outputs: {},
        },
        'manual-trigger': {
          id: 'manual-trigger',
          type: 'manual_trigger',
          name: 'Manual Trigger',
          enabled: true,
          subBlocks: {},
          outputs: {},
        },
        'agent-1': {
          id: 'agent-1',
          type: 'agent',
          name: 'Agent',
          enabled: true,
          subBlocks: {},
          outputs: {},
        },
      },
      edges: [
        { id: 'edge-1', source: 'chat-trigger', target: 'agent-1' },
        { id: 'edge-2', source: 'manual-trigger', target: 'agent-1' },
      ],
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
  })

  afterAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('forwards chat selected outputs as queue metadata without adding them to workflow input', async () => {
    const execution = await renderExecutionHook()

    await act(async () => {
      await execution.handleRunWorkflow({
        input: {
          input: 'hello',
          conversationId: 'conversation-1',
        },
        triggerType: 'chat',
        selectedOutputs: ['agent-1_content'],
      })
    })

    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        triggerType: 'chat',
        executionTarget: 'live',
        input: {
          input: 'hello',
          conversationId: 'conversation-1',
        },
        selectedOutputs: ['agent-1_content'],
        stream: true,
      }),
      expect.any(Object)
    )
  })

  it('forwards queued execution events to the workflow caller', async () => {
    const streamEvent = {
      type: 'stream:chunk',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      timestamp: new Date().toISOString(),
      data: {
        blockId: 'agent-1',
        chunk: 'streamed content',
      },
    }
    mockRunQueuedWorkflowExecution.mockImplementationOnce(async (_request, callbacks) => {
      await callbacks.onEvent(streamEvent)
      return {
        success: true,
        output: {},
        logs: [],
      }
    })

    const onEvent = vi.fn()
    const execution = await renderExecutionHook()

    await act(async () => {
      await execution.handleRunWorkflow({ onEvent })
    })

    expect(onEvent).toHaveBeenCalledWith(streamEvent)
    expect(mockConsoleState.ingestWorkflowExecutionEvent).toHaveBeenCalledWith(streamEvent)
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'manual',
        startBlockId: 'manual-trigger',
        selectedOutputs: undefined,
        stream: true,
      }),
      expect.any(Object)
    )
  })

  it('forwards every queued execution event to console ingestion', async () => {
    const blockStarted = {
      type: 'block:started',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      timestamp: new Date().toISOString(),
      data: {
        blockId: 'agent-1',
        blockName: 'Agent',
        blockType: 'agent',
        input: {},
        startedAt: '2026-04-01T00:00:00.000Z',
        iterationCurrent: 1,
        iterationTotal: 2,
      },
    }
    mockRunQueuedWorkflowExecution.mockImplementationOnce(async (_request, callbacks) => {
      await callbacks.onEvent(blockStarted)
      const firstChunk = {
        type: 'stream:chunk',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: new Date().toISOString(),
        data: {
          blockId: 'agent-1',
          chunk: 'first',
          iterationCurrent: 1,
          iterationTotal: 2,
        },
      }
      await callbacks.onEvent(firstChunk)
      const nextBlockStarted = {
        ...blockStarted,
        data: {
          ...blockStarted.data,
          iterationCurrent: 2,
        },
      }
      await callbacks.onEvent(nextBlockStarted)
      const secondChunk = {
        type: 'stream:chunk',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: new Date().toISOString(),
        data: {
          blockId: 'agent-1',
          chunk: 'second',
          iterationCurrent: 2,
          iterationTotal: 2,
        },
      }
      await callbacks.onEvent(secondChunk)
      return {
        success: true,
        output: {},
        logs: [],
      }
    })

    const execution = await renderExecutionHook()

    await act(async () => {
      await execution.handleRunWorkflow({
        input: {
          input: 'hello',
          conversationId: 'conversation-1',
        },
        triggerType: 'chat',
      })
    })

    expect(mockConsoleState.ingestWorkflowExecutionEvent).toHaveBeenNthCalledWith(1, blockStarted)
    expect(mockConsoleState.ingestWorkflowExecutionEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'stream:chunk',
        data: expect.objectContaining({ chunk: 'first', iterationCurrent: 1 }),
      })
    )
    expect(mockConsoleState.ingestWorkflowExecutionEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'block:started',
        data: expect.objectContaining({ iterationCurrent: 2 }),
      })
    )
    expect(mockConsoleState.ingestWorkflowExecutionEvent).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: 'stream:chunk',
        data: expect.objectContaining({ chunk: 'second', iterationCurrent: 2 }),
      })
    )
  })
})
