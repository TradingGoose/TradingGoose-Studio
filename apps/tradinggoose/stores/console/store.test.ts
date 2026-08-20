import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/stores/console/store')
const { useConsoleStore } = await import('./store')

let uuidCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => {
    uuidCounter += 1
    return `test-uuid-${uuidCounter}`
  }),
})

describe('Console Store', () => {
  beforeEach(() => {
    useConsoleStore.getState().clearConsole(null)
    vi.clearAllMocks()
    uuidCounter = 0
    if (global.localStorage) {
      vi.mocked(global.localStorage.getItem).mockReturnValue(null)
      vi.mocked(global.localStorage.setItem).mockClear()
    }
  })

  describe('addConsole', () => {
    it('should add a new console entry with required fields', () => {
      const store = useConsoleStore.getState()

      const newEntry = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Test Block',
        blockType: 'agent',
        success: true,
        output: { content: 'Test output' },
        durationMs: 100,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      expect(newEntry.id).toBe('test-uuid-1')
      expect(newEntry.workflowId).toBe('workflow-123')
      expect(newEntry.blockId).toBe('block-123')
      expect(newEntry.success).toBe(true)

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0]).toBe(newEntry)
    })

    it('should add entry with error', () => {
      const store = useConsoleStore.getState()

      store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Failed Block',
        blockType: 'agent',
        success: false,
        error: 'Something went wrong',
        durationMs: 50,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:00.500Z',
      })

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].success).toBe(false)
      expect(state.entries[0].error).toBe('Something went wrong')
    })

    it('should reuse a running entry for the same block execution', () => {
      const store = useConsoleStore.getState()

      const first = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Running Block',
        blockType: 'agent',
        success: true,
        output: undefined,
        durationMs: 0,
        startedAt: '2023-01-01T00:00:00.000Z',
        executionId: 'exec-1',
        iterationType: 'loop',
        iterationCurrent: 1,
        isRunning: true,
      })

      const second = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Running Block',
        blockType: 'agent',
        success: true,
        output: undefined,
        durationMs: 0,
        startedAt: '2023-01-01T00:00:00.000Z',
        executionId: 'exec-1',
        iterationType: 'loop',
        iterationCurrent: 1,
        isRunning: true,
      })

      const state = useConsoleStore.getState()
      expect(second.id).toBe(first.id)
      expect(state.entries).toHaveLength(1)
    })
  })

  describe('ingestWorkflowExecutionEvent', () => {
    it('streams workflow execution chunks and keeps repeated block runs separate', () => {
      const store = useConsoleStore.getState()
      const base = {
        executionId: 'exec-1',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.000Z',
      }

      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:00.000Z',
          iterationType: 'loop',
          iterationCurrent: 1,
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'stream:chunk',
        data: { blockId: 'agent-1', chunk: 'first' },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:completed',
        data: {
          blockId: 'agent-1',
          startedAt: '2026-04-01T00:00:00.000Z',
          iterationType: 'loop',
          iterationCurrent: 1,
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        timestamp: '2026-04-01T00:00:01.000Z',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:01.000Z',
          iterationType: 'loop',
          iterationCurrent: 2,
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'stream:chunk',
        timestamp: '2026-04-01T00:00:02.000Z',
        data: { blockId: 'agent-1', chunk: 'second' },
      })

      const entries = useConsoleStore.getState().entries
      const first = entries.find((entry) => entry.iterationCurrent === 1)
      const second = entries.find((entry) => entry.iterationCurrent === 2)

      expect(entries).toHaveLength(2)
      expect(first?.output?.content).toBe('first')
      expect(first?.isRunning).toBe(false)
      expect(second?.output?.content).toBe('second')
      expect(second?.isRunning).toBe(true)
    })

    it('streams chunks into the exact iteration entry', () => {
      const store = useConsoleStore.getState()
      const base = {
        executionId: 'exec-1',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.000Z',
      }

      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:00.000Z',
          iterationType: 'parallel',
          iterationCurrent: 1,
          iterationTotal: 2,
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:01.000Z',
          iterationType: 'parallel',
          iterationCurrent: 2,
          iterationTotal: 2,
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'stream:chunk',
        data: {
          blockId: 'agent-1',
          chunk: 'second',
          iterationType: 'parallel',
          iterationCurrent: 2,
          iterationTotal: 2,
        },
      })

      const state = useConsoleStore.getState()
      const first = state.entries.find((entry) => entry.iterationCurrent === 1)
      const second = state.entries.find((entry) => entry.iterationCurrent === 2)

      expect(first?.output?.content).toBeUndefined()
      expect(second?.output?.content).toBe('second')
    })

    it('ignores chunks that do not have a matching lifecycle entry', () => {
      const store = useConsoleStore.getState()

      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-1',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.000Z',
        type: 'stream:chunk',
        data: {
          blockId: 'agent-1',
          chunk: 'orphan',
          iterationType: 'parallel',
          iterationCurrent: 1,
        },
      })

      expect(useConsoleStore.getState().entries).toHaveLength(0)
    })

    it('completes the exact iteration entry when startedAt is absent', () => {
      const store = useConsoleStore.getState()
      const base = {
        executionId: 'exec-1',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.000Z',
      }

      for (const iterationCurrent of [1, 2]) {
        store.ingestWorkflowExecutionEvent({
          ...base,
          type: 'block:started',
          data: {
            blockId: 'agent-1',
            blockName: 'Agent',
            blockType: 'agent',
            startedAt: `2026-04-01T00:00:0${iterationCurrent}.000Z`,
            iterationType: 'parallel',
            iterationCurrent,
            iterationTotal: 2,
          },
        })
      }

      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:completed',
        data: {
          blockId: 'agent-1',
          output: { content: 'iteration 2 done', apiKey: 'raw-output-key' },
          success: true,
          endedAt: '2026-04-01T00:00:03.000Z',
          durationMs: 50,
          iterationType: 'parallel',
          iterationCurrent: 2,
          iterationTotal: 2,
        },
      })

      const entries = useConsoleStore.getState().entries
      const first = entries.find((entry) => entry.iterationCurrent === 1)
      const second = entries.find((entry) => entry.iterationCurrent === 2)

      expect(first?.isRunning).toBe(true)
      expect(first?.output?.content).toBeUndefined()
      expect(second?.isRunning).toBe(false)
      expect(second?.output?.content).toBe('iteration 2 done')
      expect(second?.output).toEqual({ content: 'iteration 2 done', apiKey: '[redacted]' })
    })

    it('does not guess when a completion event has ambiguous identity', () => {
      const store = useConsoleStore.getState()
      const base = {
        executionId: 'exec-1',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.000Z',
      }

      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:01.000Z',
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:02.000Z',
        },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:completed',
        data: {
          blockId: 'agent-1',
          output: { content: 'ambiguous' },
          success: true,
          endedAt: '2026-04-01T00:00:03.000Z',
        },
      })

      const entries = useConsoleStore.getState().entries
      const completed = entries.find((entry) => entry.output?.content === 'ambiguous')

      expect(entries.filter((entry) => entry.isRunning)).toHaveLength(2)
      expect(completed).toBeUndefined()
    })

    it('finalizes every running entry for a completed execution without touching other entries', () => {
      const store = useConsoleStore.getState()
      const startedAt = '2026-04-01T00:00:00.000Z'

      for (const [workflowId, executionId, blockId, iterationCurrent] of [
        ['workflow-1', 'exec-1', 'matching-1', 1],
        ['workflow-1', 'exec-1', 'matching-2', 2],
        ['workflow-1', 'exec-2', 'other-execution', 1],
        ['workflow-2', 'exec-1', 'other-workflow', 1],
      ] as const) {
        store.ingestWorkflowExecutionEvent({
          workflowId,
          executionId,
          timestamp: startedAt,
          type: 'block:started',
          data: { blockId, startedAt, iterationType: 'parallel', iterationCurrent },
        })
      }

      store.addConsole({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        blockId: 'matching-with-duration',
        success: true,
        startedAt,
        durationMs: 750,
        isRunning: true,
        isCanceled: false,
      })
      const alreadyCompleted = store.addConsole({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        blockId: 'already-completed',
        success: true,
        startedAt,
        endedAt: '2026-04-01T00:00:01.000Z',
        durationMs: 1000,
        isRunning: false,
        isCanceled: false,
      })
      const alreadyFailed = store.addConsole({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        blockId: 'already-failed',
        success: false,
        error: 'Specific block error',
        startedAt,
        endedAt: '2026-04-01T00:00:01.500Z',
        durationMs: 1500,
        isRunning: false,
        isCanceled: false,
      })
      const alreadyCanceled = store.addConsole({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        blockId: 'already-canceled',
        success: false,
        startedAt,
        endedAt: '2026-04-01T00:00:02.000Z',
        durationMs: 2000,
        isRunning: false,
        isCanceled: true,
      })

      const terminalEvent = {
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        timestamp: '2026-04-01T00:00:03.000Z',
        type: 'execution:completed' as const,
        data: { result: { success: true, output: {} } },
      }
      store.ingestWorkflowExecutionEvent(terminalEvent)

      const firstState = useConsoleStore.getState().entries
      const matching = firstState.filter(
        (entry) =>
          entry.workflowId === 'workflow-1' &&
          entry.executionId === 'exec-1' &&
          entry.blockId.startsWith('matching')
      )
      expect(matching).toHaveLength(3)
      expect(matching).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockId: 'matching-1',
            isRunning: false,
            isCanceled: false,
            endedAt: terminalEvent.timestamp,
            durationMs: 3000,
          }),
          expect.objectContaining({
            blockId: 'matching-2',
            isRunning: false,
            isCanceled: false,
            endedAt: terminalEvent.timestamp,
            durationMs: 3000,
          }),
          expect.objectContaining({
            blockId: 'matching-with-duration',
            isRunning: false,
            isCanceled: false,
            endedAt: terminalEvent.timestamp,
            durationMs: 750,
          }),
        ])
      )
      expect(firstState.find((entry) => entry.blockId === 'other-execution')?.isRunning).toBe(true)
      expect(firstState.find((entry) => entry.blockId === 'other-workflow')?.isRunning).toBe(true)
      expect(firstState.find((entry) => entry.id === alreadyCompleted.id)).toBe(alreadyCompleted)
      expect(firstState.find((entry) => entry.id === alreadyFailed.id)).toBe(alreadyFailed)
      expect(firstState.find((entry) => entry.id === alreadyCanceled.id)).toBe(alreadyCanceled)

      const snapshot = structuredClone(firstState)
      store.ingestWorkflowExecutionEvent(terminalEvent)
      expect(useConsoleStore.getState().entries).toEqual(snapshot)
    })

    it('marks running entries failed and preserves a more specific block error', () => {
      const store = useConsoleStore.getState()
      const base = {
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        timestamp: '2026-04-01T00:00:00.000Z',
      }

      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: { blockId: 'specific', startedAt: base.timestamp, error: 'Block failed precisely' },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        type: 'block:started',
        data: { blockId: 'fallback', startedAt: base.timestamp },
      })
      store.ingestWorkflowExecutionEvent({
        ...base,
        timestamp: '2026-04-01T00:00:02.000Z',
        type: 'execution:error',
        data: {
          error: 'Workflow execution failed',
          result: { success: false, output: {}, error: 'Workflow execution failed' },
        },
      })

      const entries = useConsoleStore.getState().entries
      expect(entries.find((entry) => entry.blockId === 'specific')).toEqual(
        expect.objectContaining({
          success: false,
          error: 'Block failed precisely',
          isRunning: false,
          isCanceled: false,
          endedAt: '2026-04-01T00:00:02.000Z',
          durationMs: 2000,
        })
      )
      expect(entries.find((entry) => entry.blockId === 'fallback')).toEqual(
        expect.objectContaining({
          success: false,
          error: 'Workflow execution failed',
          isRunning: false,
          isCanceled: false,
          endedAt: '2026-04-01T00:00:02.000Z',
          durationMs: 2000,
        })
      )
    })

    it('derives missing duration from a preserved terminal timestamp', () => {
      const store = useConsoleStore.getState()
      const entry = store.addConsole({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        blockId: 'partially-terminal',
        success: true,
        startedAt: '2026-04-01T00:00:00.000Z',
        endedAt: '2026-04-01T00:00:01.000Z',
        durationMs: 0,
        isRunning: true,
        isCanceled: false,
      })
      const terminalEvent = {
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        timestamp: '2026-04-01T00:00:03.000Z',
        type: 'execution:completed' as const,
        data: { result: { success: true, output: {} } },
      }

      store.ingestWorkflowExecutionEvent(terminalEvent)

      expect(
        useConsoleStore.getState().entries.find((candidate) => candidate.id === entry.id)
      ).toEqual(
        expect.objectContaining({
          endedAt: '2026-04-01T00:00:01.000Z',
          durationMs: 1000,
          isRunning: false,
          isCanceled: false,
        })
      )
      const snapshot = structuredClone(useConsoleStore.getState().entries)
      store.ingestWorkflowExecutionEvent(terminalEvent)
      expect(useConsoleStore.getState().entries).toEqual(snapshot)
    })

    it('marks a running entry canceled and handles invalid or missing start timing safely', () => {
      const store = useConsoleStore.getState()
      store.ingestWorkflowExecutionEvent({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        timestamp: 'invalid-start',
        type: 'block:started',
        data: { blockId: 'invalid', startedAt: 'invalid-start' },
      })
      store.addConsole({
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        blockId: 'missing',
        success: true,
        durationMs: 125,
        isRunning: true,
        isCanceled: false,
      })

      const terminalEvent = {
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        timestamp: '2026-04-01T00:00:02.000Z',
        type: 'execution:cancelled' as const,
        data: {
          result: { success: false, output: {}, error: 'Workflow execution was cancelled' },
        },
      }
      store.ingestWorkflowExecutionEvent(terminalEvent)

      const entries = useConsoleStore.getState().entries
      expect(entries.find((entry) => entry.blockId === 'invalid')).toEqual(
        expect.objectContaining({
          success: false,
          isRunning: false,
          isCanceled: true,
          endedAt: terminalEvent.timestamp,
          durationMs: 0,
        })
      )
      expect(entries.find((entry) => entry.blockId === 'missing')).toEqual(
        expect.objectContaining({
          success: false,
          isRunning: false,
          isCanceled: true,
          endedAt: terminalEvent.timestamp,
          durationMs: 125,
        })
      )
      expect(entries.every((entry) => Number.isFinite(entry.durationMs))).toBe(true)
    })

    it('clears a terminal execution buffer with no running match and preserves other buffers', () => {
      const store = useConsoleStore.getState()
      const executionId = 'shared-execution-id'

      for (const workflowId of ['workflow-1', 'workflow-2']) {
        store.ingestWorkflowExecutionEvent({
          workflowId,
          executionId,
          timestamp: '2026-04-01T00:00:00.000Z',
          type: 'block:started',
          data: { blockId: 'agent-1', startedAt: '2026-04-01T00:00:00.000Z' },
        })
        store.ingestWorkflowExecutionEvent({
          workflowId,
          executionId,
          timestamp: '2026-04-01T00:00:01.000Z',
          type: 'stream:chunk',
          data: { blockId: 'agent-1', chunk: `${workflowId}-before` },
        })
      }

      store.cancelRunningEntries('workflow-1')
      const beforeTerminal = structuredClone(useConsoleStore.getState().entries)
      store.ingestWorkflowExecutionEvent({
        workflowId: 'workflow-1',
        executionId,
        timestamp: '2026-04-01T00:00:02.000Z',
        type: 'execution:completed',
        data: { result: { success: true, output: {} } },
      })
      expect(useConsoleStore.getState().entries).toEqual(beforeTerminal)

      store.addConsole({
        workflowId: 'workflow-1',
        executionId,
        blockId: 'agent-1',
        success: true,
        startedAt: '2026-04-01T00:00:03.000Z',
        durationMs: 0,
        isRunning: true,
        isCanceled: false,
      })
      store.ingestWorkflowExecutionEvent({
        workflowId: 'workflow-1',
        executionId,
        timestamp: '2026-04-01T00:00:04.000Z',
        type: 'stream:chunk',
        data: { blockId: 'agent-1', chunk: 'fresh-target' },
      })
      store.ingestWorkflowExecutionEvent({
        workflowId: 'workflow-2',
        executionId,
        timestamp: '2026-04-01T00:00:04.000Z',
        type: 'stream:chunk',
        data: { blockId: 'agent-1', chunk: '-after' },
      })

      const entries = useConsoleStore.getState().entries
      expect(
        entries.find(
          (entry) => entry.workflowId === 'workflow-1' && entry.startedAt?.endsWith('03.000Z')
        )?.output?.content
      ).toBe('fresh-target')
      expect(entries.find((entry) => entry.workflowId === 'workflow-2')?.output?.content).toBe(
        'workflow-2-before-after'
      )
    })

    it('reconciles and clears only the matching workflow stream buffer', () => {
      const store = useConsoleStore.getState()
      const executionId = 'shared-execution-id'

      for (const workflowId of ['workflow-1', 'workflow-2']) {
        store.ingestWorkflowExecutionEvent({
          workflowId,
          executionId,
          timestamp: '2026-04-01T00:00:00.000Z',
          type: 'block:started',
          data: { blockId: 'agent-1' },
        })
        store.ingestWorkflowExecutionEvent({
          workflowId,
          executionId,
          timestamp: '2026-04-01T00:00:01.000Z',
          type: 'stream:chunk',
          data: { blockId: 'agent-1', chunk: workflowId },
        })
      }

      store.ingestWorkflowExecutionEvent({
        workflowId: 'workflow-1',
        executionId,
        timestamp: '2026-04-01T00:00:02.000Z',
        type: 'execution:completed',
        data: { result: { success: true, output: {} } },
      })
      store.ingestWorkflowExecutionEvent({
        workflowId: 'workflow-2',
        executionId,
        timestamp: '2026-04-01T00:00:03.000Z',
        type: 'stream:chunk',
        data: { blockId: 'agent-1', chunk: '-continued' },
      })

      const entries = useConsoleStore.getState().entries
      expect(entries.find((entry) => entry.workflowId === 'workflow-1')?.isRunning).toBe(false)
      expect(entries.find((entry) => entry.workflowId === 'workflow-2')).toEqual(
        expect.objectContaining({
          isRunning: true,
          output: { content: 'workflow-2-continued' },
        })
      )
    })
  })

  describe('clearConsole', () => {
    beforeEach(() => {
      const store = useConsoleStore.getState()

      store.addConsole({
        workflowId: 'workflow-1',
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'agent',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      store.addConsole({
        workflowId: 'workflow-2',
        blockId: 'block-2',
        blockName: 'Block 2',
        blockType: 'api',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })
    })

    it('should clear all entries when workflowId is null', () => {
      const store = useConsoleStore.getState()

      store.clearConsole(null)

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(0)
    })

    it('should clear only specific workflow entries', () => {
      const store = useConsoleStore.getState()

      store.clearConsole('workflow-1')

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].workflowId).toBe('workflow-2')
    })

    it('clears stream buffers for the removed workflow', () => {
      const store = useConsoleStore.getState()

      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-stream-clear',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.000Z',
        type: 'block:started',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:00.000Z',
        },
      })
      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-stream-clear',
        workflowId: 'workflow-1',
        timestamp: '2026-04-01T00:00:00.100Z',
        type: 'stream:chunk',
        data: { blockId: 'agent-1', chunk: 'before-clear' },
      })

      store.clearConsole('workflow-1')

      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-stream-clear',
        workflowId: 'workflow-1',
        type: 'block:started',
        timestamp: '2026-04-01T00:00:01.000Z',
        data: {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2026-04-01T00:00:01.000Z',
        },
      })
      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-stream-clear',
        workflowId: 'workflow-1',
        type: 'stream:chunk',
        timestamp: '2026-04-01T00:00:01.100Z',
        data: { blockId: 'agent-1', chunk: 'after-clear' },
      })

      const entries = useConsoleStore
        .getState()
        .entries.filter((entry) => entry.workflowId === 'workflow-1')

      expect(entries).toHaveLength(1)
      expect(entries[0]?.output?.content).toBe('after-clear')
    })
  })

  describe('cancelRunningEntries', () => {
    beforeEach(() => {
      const store = useConsoleStore.getState()

      store.addConsole({
        workflowId: 'workflow-1',
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'agent',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
        isRunning: true,
      })

      store.addConsole({
        workflowId: 'workflow-2',
        blockId: 'block-2',
        blockName: 'Block 2',
        blockType: 'api',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
        isRunning: true,
      })
    })

    it('should mark running entries as canceled for a workflow', () => {
      const store = useConsoleStore.getState()

      store.cancelRunningEntries('workflow-1')

      const state = useConsoleStore.getState()
      const workflow1Entry = state.entries.find((entry) => entry.workflowId === 'workflow-1')
      const workflow2Entry = state.entries.find((entry) => entry.workflowId === 'workflow-2')

      expect(workflow1Entry?.isRunning).toBe(false)
      expect(workflow1Entry?.isCanceled).toBe(true)
      expect(workflow1Entry?.success).toBe(false)
      expect(workflow2Entry?.isRunning).toBe(true)
      expect(workflow2Entry?.isCanceled).toBeUndefined()
      expect(workflow2Entry?.success).toBe(true)
    })
  })
})
