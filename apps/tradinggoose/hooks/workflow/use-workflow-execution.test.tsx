/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRunQueuedWorkflowExecution = vi.hoisted(() => vi.fn())
const mockWorkflowDoc = vi.hoisted(() => ({}))
const mockReadWorkflowSnapshot = vi.hoisted(() => vi.fn())
const mockUseWorkflowSession = vi.hoisted(() => vi.fn())
const mockGetVariablesSnapshot = vi.hoisted(() => vi.fn())
const mockWorkflowRoute = vi.hoisted(() => ({
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  channelId: 'channel-1',
}))

vi.unmock('@/blocks/registry')

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

vi.mock('@/lib/yjs/workflow-session', () => ({
  getVariablesSnapshot: mockGetVariablesSnapshot,
}))

vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useWorkflowSession: mockUseWorkflowSession,
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

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkflowRoute: vi.fn(() => mockWorkflowRoute),
}))

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({
    shortInput: { wandPlaceholder: 'Describe the change' },
    wandPromptBar: {
      generating: 'Generating...',
      generationFailed: 'Generation failed. Your prompt is ready to retry.',
    },
  }),
}))

import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { useWand } from './use-wand'
import { useWorkflowExecution } from './use-workflow-execution'

describe('useWorkflowExecution', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT
  const agentBlock = {
    id: 'agent-1',
    type: 'agent',
    name: 'Agent',
    enabled: true,
    subBlocks: {},
    outputs: {},
  }
  const editableSession = {
    canEdit: true,
    doc: mockWorkflowDoc,
    error: null,
    isLoading: false,
    readWorkflowSnapshot: mockReadWorkflowSnapshot,
  }

  function mockSingleTriggerSnapshot(
    triggerId: string,
    type: string,
    name: string,
    subBlocks: Record<string, unknown> = {}
  ) {
    mockReadWorkflowSnapshot.mockReturnValue({
      blocks: {
        [triggerId]: { id: triggerId, type, name, enabled: true, subBlocks, outputs: {} },
        'agent-1': agentBlock,
      },
      edges: [{ id: 'edge-1', source: triggerId, target: 'agent-1' }],
    })
  }

  async function renderExecutionHook() {
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

  async function renderExecutionOwners() {
    const state: {
      first: ReturnType<typeof useWorkflowExecution> | null
      second: ReturnType<typeof useWorkflowExecution> | null
    } = { first: null, second: null }

    function Harness() {
      state.first = useWorkflowExecution()
      state.second = useWorkflowExecution()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(React.createElement(Harness))
    })
    return state
  }

  async function renderMutableExecutionHook() {
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
    const rerender = async () => {
      await act(async () => {
        root?.render(React.createElement(Harness))
      })
    }
    await rerender()
    return { rerender, state }
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
    mockUseWorkflowSession.mockReturnValue(editableSession)
    mockWorkflowRoute.workflowId = 'workflow-1'
    mockWorkflowRoute.workspaceId = 'workspace-1'
    mockWorkflowRoute.channelId = 'channel-1'
    mockGetVariablesSnapshot.mockReturnValue({})
    mockReadWorkflowSnapshot.mockReturnValue({
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
        'agent-1': agentBlock,
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

  it('does not run chat-only workflows through editor Run', async () => {
    mockSingleTriggerSnapshot('chat-trigger', 'chat_trigger', 'Chat Trigger')

    const execution = await renderExecutionHook()

    await act(async () => {
      await execution.handleRunWorkflow({ triggerBlockId: 'chat-trigger' })
    })

    expect(mockRunQueuedWorkflowExecution).not.toHaveBeenCalled()
  })

  it('blocks retained execution callbacks for readers before any execution mutation', async () => {
    mockUseWorkflowSession.mockReturnValue({ ...editableSession, canEdit: false })
    const execution = await renderExecutionHook()

    await act(() => execution.handleRunWorkflow({ triggerBlockId: 'manual-trigger' }))

    expect(execution.isWorkflowSessionReady).toBe(false)
    expect(mockExecutionState.setIsExecuting).not.toHaveBeenCalled()
    expect(mockRunQueuedWorkflowExecution).not.toHaveBeenCalled()
  })

  it('forwards queued execution events to the workflow caller', async () => {
    mockSingleTriggerSnapshot('schedule-trigger', 'schedule', 'Schedule')
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
      await execution.handleRunWorkflow({ triggerBlockId: 'schedule-trigger', onEvent })
    })

    expect(onEvent).toHaveBeenCalledWith(streamEvent)
    expect(mockConsoleState.ingestWorkflowExecutionEvent).toHaveBeenCalledWith(streamEvent)
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'manual',
        triggerBlockId: 'schedule-trigger',
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

  it('serializes owners and lets any owner cancel only the admitted execution', async () => {
    let rejectRun: ((error: Error) => void) | undefined
    mockRunQueuedWorkflowExecution.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          rejectRun = reject
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    const owners = await renderExecutionOwners()
    const first = owners.first
    const second = owners.second
    if (!first || !second) throw new Error('Execution owners did not render')

    const admitted = vi.fn()
    const rejectedAdmission = vi.fn()
    let admittedRun: ReturnType<typeof first.handleRunWorkflow>
    await act(async () => {
      admittedRun = first.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
        onAdmitted: admitted,
      })
      void first.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
        onAdmitted: rejectedAdmission,
      })
      void second.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
        onAdmitted: rejectedAdmission,
      })
      await Promise.resolve()
    })

    expect(admitted).toHaveBeenCalledOnce()
    expect(rejectedAdmission).not.toHaveBeenCalled()
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledOnce()
    expect(owners.first?.manualRunFeedback).toEqual({ state: 'running' })
    expect(owners.second?.manualRunFeedback).toEqual({ state: 'idle' })

    await act(async () => {
      second.handleCancelExecution()
      void second.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
        onAdmitted: rejectedAdmission,
      })
      await admittedRun!
    })

    expect(rejectedAdmission).not.toHaveBeenCalled()
    expect(mockConsoleState.cancelRunningEntries).toHaveBeenCalledWith('workflow-1')
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledOnce()
    expect(rejectRun).toBeTypeOf('function')

    await act(async () => {
      await owners.second?.handleRunWorkflow({ triggerBlockId: 'manual-trigger' })
    })
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledTimes(2)
    expect(owners.second?.manualRunFeedback).toEqual({ state: 'success' })
    expect(owners.first?.manualRunFeedback).toEqual({ state: 'idle' })
  })

  it.each([
    {
      label: 'success',
      result: { success: true, output: {}, logs: [] },
      expected: { state: 'success' },
    },
    {
      label: 'failure',
      result: { success: false, output: {}, error: 'Driver failed', logs: [] },
      expected: { state: 'error', message: 'Driver failed' },
    },
  ])(
    'does not restore settled $label feedback after workflow navigation',
    async ({ result, expected }) => {
      mockRunQueuedWorkflowExecution.mockResolvedValueOnce(result)
      const harness = await renderMutableExecutionHook()

      await act(async () => {
        await harness.state.execution?.handleRunWorkflow({
          triggerBlockId: 'manual-trigger',
        })
      })
      expect(harness.state.execution?.manualRunFeedback).toEqual(expected)

      mockWorkflowRoute.workflowId = 'workflow-2'
      await harness.rerender()
      expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'idle' })

      mockWorkflowRoute.workflowId = 'workflow-1'
      await harness.rerender()
      expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'idle' })
    }
  )

  it('keeps an old running lease cancellable while hiding it from a new workflow', async () => {
    mockRunQueuedWorkflowExecution.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    const harness = await renderMutableExecutionHook()
    let oldRun: Promise<unknown> | undefined

    await act(async () => {
      oldRun = harness.state.execution?.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
      })
      await Promise.resolve()
    })
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'running' })

    mockWorkflowRoute.workflowId = 'workflow-2'
    await harness.rerender()
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'idle' })

    await act(async () => {
      await harness.state.execution?.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
      })
    })
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledOnce()

    await act(async () => {
      harness.state.execution?.handleCancelExecution()
      await oldRun
    })
    expect(mockConsoleState.cancelRunningEntries).toHaveBeenCalledWith('workflow-1')
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'idle' })

    await act(async () => {
      await harness.state.execution?.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
      })
    })
    expect(mockRunQueuedWorkflowExecution).toHaveBeenCalledTimes(2)
    expect(mockRunQueuedWorkflowExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowId: 'workflow-2' }),
      expect.any(Object)
    )
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'success' })
  })
})

const generatedWandContent = vi.fn()
let currentWand: ReturnType<typeof useWand> | null = null

function WandHarness() {
  const wand = useWand({
    wandConfig: { enabled: true, prompt: 'Generate content.' },
    onGeneratedContent: generatedWandContent,
  })
  currentWand = wand
  return (
    <WandPromptBar
      isVisible={wand.isPromptVisible}
      isLoading={wand.isLoading}
      isStreaming={wand.isStreaming}
      hasFailure={Boolean(wand.error)}
      promptValue={wand.promptInputValue}
      onSubmit={(prompt) => wand.generateStream({ prompt })}
      onCancel={wand.hidePromptInline}
      onChange={wand.updatePromptValue}
    />
  )
}

const wandStreamResponse = (payload: string) => ({
  ok: true,
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  }),
})

describe('useWand feedback', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    generatedWandContent.mockReset()
    currentWand = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<WandHarness />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('surfaces SSE failure safely, retains the prompt for retry, and clears it after success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(wandStreamResponse('data: {"error":"private upstream detail"}\n\n'))
        .mockResolvedValueOnce(
          wandStreamResponse('data: {"chunk":"generated"}\n\ndata: {"done":true}\n\n')
        )
    )

    act(() => {
      currentWand?.showPromptInline()
      currentWand?.updatePromptValue('Keep this prompt')
    })
    await act(async () => {
      await currentWand?.generateStream({ prompt: 'Keep this prompt' })
    })

    expect(currentWand?.error).toBe('private upstream detail')
    expect(currentWand?.promptInputValue).toBe('Keep this prompt')
    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toBe('Generation failed. Your prompt is ready to retry.')
    expect(alert?.textContent).not.toContain('private upstream detail')
    expect(container.querySelector('input')?.getAttribute('aria-describedby')).toBe(alert?.id)

    await act(async () => {
      await currentWand?.generateStream({ prompt: currentWand.promptInputValue })
    })

    expect(currentWand?.error).toBeNull()
    expect(currentWand?.promptInputValue).toBe('')
    expect(generatedWandContent).toHaveBeenCalledWith('generated')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
