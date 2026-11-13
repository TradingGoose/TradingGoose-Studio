/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompletionEvent } from '@/lib/copilot/native/contract'

const mockQueueWorkflowExecution = vi.hoisted(() => vi.fn())
const mockObserveQueuedWorkflowExecution = vi.hoisted(() => vi.fn())
const mockCancelQueuedWorkflowExecution = vi.hoisted(() => vi.fn())
const mockAuth = vi.hoisted(() => ({ userId: 'user-1' }))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mockAuth.userId } } }),
}))
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
  queueWorkflowExecution: mockQueueWorkflowExecution,
  cancelQueuedWorkflowExecution: mockCancelQueuedWorkflowExecution,
  observeQueuedWorkflowExecution: mockObserveQueuedWorkflowExecution,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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
    const { state } = await renderMutableExecutionHook()
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
    const savedExecutions = new Map<string, string>()
    vi.mocked(sessionStorage.getItem).mockImplementation((key) => savedExecutions.get(key) ?? null)
    vi.mocked(sessionStorage.setItem).mockImplementation((key, value) => {
      savedExecutions.set(key, value)
    })
    vi.mocked(sessionStorage.removeItem).mockImplementation((key) => {
      savedExecutions.delete(key)
    })
    mockAuth.userId = 'user-1'
    mockQueueWorkflowExecution.mockResolvedValue({
      taskId: 'admitted-job',
      executionId: 'admitted-execution',
    })
    mockCancelQueuedWorkflowExecution.mockResolvedValue(undefined)
    mockObserveQueuedWorkflowExecution.mockResolvedValue({
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

  it('reconnects the persisted execution after reload without submitting another run', async () => {
    const handle = { taskId: 'admitted-job', executionId: 'admitted-execution' }
    sessionStorage.setItem('workflow-execution:user-1:workflow-1', JSON.stringify(handle))
    const completion = deferred<unknown>()
    mockObserveQueuedWorkflowExecution.mockReturnValueOnce(completion.promise)
    const { state } = await renderMutableExecutionHook()
    expect(mockObserveQueuedWorkflowExecution).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        callbacks: { onEvent: expect.any(Function) },
      })
    )
    expect(mockQueueWorkflowExecution).not.toHaveBeenCalled()
    expect(state.execution?.manualRunFeedback.state).toBe('running')
    await act(async () =>
      completion.resolve({ success: true, output: { answer: 'Restored' }, logs: [] })
    )
    expect(state.execution?.manualRunFeedback.state).toBe('success')
    expect(sessionStorage.getItem('workflow-execution:user-1:workflow-1')).toBeNull()
    expect(mockExecutionState.setIsExecuting).toHaveBeenLastCalledWith(false)
    expect(mockConsoleState.addConsole).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'admitted-execution',
        output: { answer: 'Restored' },
        success: true,
      })
    )
  })

  it("does not restore another authenticated user's execution handle", async () => {
    sessionStorage.setItem(
      'workflow-execution:another-user:workflow-1',
      JSON.stringify({ taskId: 'private', executionId: 'private' })
    )
    await renderExecutionHook()
    expect(mockObserveQueuedWorkflowExecution).not.toHaveBeenCalled()
    expect(mockQueueWorkflowExecution).not.toHaveBeenCalled()
  })

  it('retains the admitted handle when observation fails without claiming the job settled', async () => {
    const saved = JSON.stringify({ taskId: 'existing', executionId: 'existing' })
    sessionStorage.setItem('workflow-execution:user-1:workflow-1', saved)
    mockObserveQueuedWorkflowExecution.mockRejectedValueOnce(
      new Error('Observation interrupted; execution outcome is unknown')
    )
    const { state } = await renderMutableExecutionHook()
    expect(state.execution?.manualRunFeedback).toEqual({
      state: 'error',
      message: 'Observation interrupted; execution outcome is unknown',
    })
    expect(sessionStorage.getItem('workflow-execution:user-1:workflow-1')).toBe(saved)
    expect(mockQueueWorkflowExecution).not.toHaveBeenCalled()
    expect(mockExecutionState.setIsExecuting).toHaveBeenLastCalledWith(false)
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

    expect(mockQueueWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        triggerType: 'chat',
        executionTarget: 'live',
        input: {
          input: 'hello',
          conversationId: 'conversation-1',
        },
        selectedOutputs: ['agent-1_content'],
      })
    )
  })

  it('does not run chat-only workflows through editor Run', async () => {
    mockSingleTriggerSnapshot('chat-trigger', 'chat_trigger', 'Chat Trigger')

    const execution = await renderExecutionHook()

    await act(async () => {
      await execution.handleRunWorkflow({ triggerBlockId: 'chat-trigger' })
    })

    expect(mockQueueWorkflowExecution).not.toHaveBeenCalled()
  })

  it('blocks retained execution callbacks for readers before any execution mutation', async () => {
    mockUseWorkflowSession.mockReturnValue({ ...editableSession, canEdit: false })
    const execution = await renderExecutionHook()

    await act(() => execution.handleRunWorkflow({ triggerBlockId: 'manual-trigger' }))

    expect(execution.isWorkflowSessionReady).toBe(false)
    expect(mockExecutionState.setIsExecuting).not.toHaveBeenCalled()
    expect(mockQueueWorkflowExecution).not.toHaveBeenCalled()
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
    mockObserveQueuedWorkflowExecution.mockImplementationOnce(async (_handle, { callbacks }) => {
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
    expect(mockQueueWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'manual',
        triggerBlockId: 'schedule-trigger',
        selectedOutputs: undefined,
      })
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
    mockObserveQueuedWorkflowExecution.mockImplementationOnce(async (_handle, { callbacks }) => {
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

  it('serializes owners and sends Stop only for the admitted job, waiting for its final result', async () => {
    const completion = deferred<unknown>()
    mockObserveQueuedWorkflowExecution.mockReturnValueOnce(completion.promise)
    const owners = await renderExecutionOwners()
    const admitted = vi.fn()
    const rejectedAdmission = vi.fn()
    let admittedRun: Promise<unknown> | undefined
    await act(async () => {
      admittedRun = owners.first?.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
        onAdmitted: admitted,
      })
      void owners.second?.handleRunWorkflow({
        triggerBlockId: 'manual-trigger',
        onAdmitted: rejectedAdmission,
      })
    })
    expect(admitted).toHaveBeenCalledOnce()
    expect(rejectedAdmission).not.toHaveBeenCalled()
    expect(mockQueueWorkflowExecution).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem('workflow-execution:user-1:workflow-1')!)).toEqual({
      taskId: 'admitted-job',
      executionId: 'admitted-execution',
    })
    expect(mockCancelQueuedWorkflowExecution).not.toHaveBeenCalled()

    await act(async () => {
      await owners.second?.handleCancelExecution()
    })
    expect(mockCancelQueuedWorkflowExecution).toHaveBeenCalledExactlyOnceWith('admitted-job')
    expect(mockObserveQueuedWorkflowExecution.mock.calls[0][1].signal.aborted).toBe(false)
    expect(owners.first?.manualRunFeedback).toEqual({ state: 'running' })
    expect(mockConsoleState.cancelRunningEntries).not.toHaveBeenCalled()
    await act(async () => {
      completion.resolve({
        success: false,
        output: {},
        error: 'Workflow execution was cancelled',
        logs: [],
      })
      await admittedRun
    })
    expect(sessionStorage.getItem('workflow-execution:user-1:workflow-1')).toBeNull()
    await act(async () => {
      await owners.second?.handleRunWorkflow({ triggerBlockId: 'manual-trigger' })
    })
    expect(mockQueueWorkflowExecution).toHaveBeenCalledTimes(2)
    expect(owners.second?.manualRunFeedback).toEqual({ state: 'success' })
  })

  it('sends Stop after admission returns its identity without dropping observation', async () => {
    const admission = deferred<unknown>()
    mockQueueWorkflowExecution.mockReturnValueOnce(admission.promise)
    const execution = await renderExecutionHook()
    let run: Promise<unknown> | undefined
    await act(async () => {
      run = execution.handleRunWorkflow({ triggerBlockId: 'manual-trigger' })
    })
    await act(async () => {
      await execution.handleCancelExecution()
    })
    expect(mockCancelQueuedWorkflowExecution).not.toHaveBeenCalled()
    await act(async () => {
      admission.resolve({ taskId: 'late-admission', executionId: 'late-admission' })
      await run
    })
    expect(mockCancelQueuedWorkflowExecution).toHaveBeenCalledExactlyOnceWith('late-admission')
    expect(mockObserveQueuedWorkflowExecution.mock.calls[0][1].signal.aborted).toBe(false)
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
      mockObserveQueuedWorkflowExecution.mockResolvedValueOnce(result)
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

  it('detaches on navigation and reconnects the admitted job when returning', async () => {
    mockObserveQueuedWorkflowExecution.mockImplementationOnce(
      (_handle, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason))
        )
    )
    const harness = await renderMutableExecutionHook()
    let oldRun: Promise<unknown> | undefined
    await act(async () => {
      oldRun = harness.state.execution?.handleRunWorkflow({ triggerBlockId: 'manual-trigger' })
    })
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'running' })
    mockWorkflowRoute.workflowId = 'workflow-2'
    await harness.rerender()
    await oldRun
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'idle' })
    expect(mockObserveQueuedWorkflowExecution.mock.calls[0][1].signal.aborted).toBe(true)
    expect(mockCancelQueuedWorkflowExecution).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('workflow-execution:user-1:workflow-1')).not.toBeNull()

    mockWorkflowRoute.workflowId = 'workflow-1'
    await harness.rerender()
    expect(mockObserveQueuedWorkflowExecution).toHaveBeenCalledTimes(2)
    expect(mockQueueWorkflowExecution).toHaveBeenCalledOnce()
    expect(harness.state.execution?.manualRunFeedback).toEqual({ state: 'success' })
  })

  it.each(['actor', 'unmount'])(
    'ignores late events and results after %s detachment',
    async (change) => {
      const completion = deferred<unknown>()
      mockObserveQueuedWorkflowExecution.mockReturnValueOnce(completion.promise)
      const harness = await renderMutableExecutionHook()
      let oldRun: Promise<unknown> | undefined
      await act(async () => {
        oldRun = harness.state.execution?.handleRunWorkflow({ triggerBlockId: 'manual-trigger' })
      })
      const observation = mockObserveQueuedWorkflowExecution.mock.calls[0][1]
      if (change === 'actor') {
        mockAuth.userId = 'user-2'
        await harness.rerender()
      } else {
        await act(async () => root?.unmount())
        root = null
      }
      expect(observation.signal.aborted).toBe(true)
      mockConsoleState.ingestWorkflowExecutionEvent.mockClear()
      mockConsoleState.addConsole.mockClear()
      await act(async () => {
        await observation.callbacks.onEvent({ type: 'stream:chunk', data: { chunk: 'private' } })
        completion.resolve({ success: true, output: { private: true }, logs: [] })
        await oldRun
      })
      expect(mockConsoleState.ingestWorkflowExecutionEvent).not.toHaveBeenCalled()
      expect(mockConsoleState.addConsole).not.toHaveBeenCalled()
      expect(mockCancelQueuedWorkflowExecution).not.toHaveBeenCalled()
      if (change === 'actor') {
        await act(async () => {
          await harness.state.execution?.handleRunWorkflow({ triggerBlockId: 'manual-trigger' })
        })
        expect(mockQueueWorkflowExecution).toHaveBeenCalledTimes(2)
      }
    }
  )
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

const wandStreamResponse = (events: CompletionEvent[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events)
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  )

describe('useWand feedback', () => {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  let previousActEnvironment: boolean | undefined
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('surfaces SSE failure safely, retains the prompt for retry, and clears it after success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          wandStreamResponse([
            {
              error: 'private upstream detail',
              code: 'NATIVE_FAILURE',
              refusal: false,
            },
          ])
        )
        .mockResolvedValueOnce(
          wandStreamResponse([
            { chunk: 'uncommitted preview' },
            {
              done: true,
              result: {
                status: 'completed',
                runId: 'wand-feedback-run',
                text: 'generated',
              },
            },
          ])
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
    expect(generatedWandContent).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toBe('Generation failed. Your prompt is ready to retry.')
    expect(alert?.textContent).not.toContain('private upstream detail')
    expect(container.querySelector('input')?.getAttribute('aria-describedby')).toBe(alert?.id)

    await act(async () => {
      await currentWand?.generateStream({ prompt: currentWand.promptInputValue })
    })

    expect(currentWand?.error).toBeNull()
    expect(currentWand?.promptInputValue).toBe('')
    expect(generatedWandContent).toHaveBeenCalledExactlyOnceWith('generated')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
