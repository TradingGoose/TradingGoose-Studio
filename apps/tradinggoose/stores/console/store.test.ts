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

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    redactApiKeys: vi.fn((obj) => obj), // Return object as-is for testing
  }
})

describe('Console Store', () => {
  beforeEach(() => {
    useConsoleStore.getState().clearConsole(null)
    vi.clearAllMocks()
    uuidCounter = 0
    // Clear localStorage mock
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

      expect(newEntry).toBeDefined()
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
          output: { content: 'iteration 2 done' },
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
  })

  describe('clearConsole', () => {
    beforeEach(() => {
      const store = useConsoleStore.getState()

      // Add multiple entries for different workflows
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

      expect(store.entries).toHaveLength(2)

      store.clearConsole(null)

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(0)
    })

    it('should clear only specific workflow entries', () => {
      const store = useConsoleStore.getState()

      expect(store.entries).toHaveLength(2)

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
        type: 'stream:chunk',
        data: { blockId: 'agent-1', chunk: 'before-clear' },
      })

      store.clearConsole('workflow-1')

      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-stream-clear',
        workflowId: 'workflow-1',
        type: 'stream:chunk',
        timestamp: '2026-04-01T00:00:01.000Z',
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
      expect(workflow2Entry?.isRunning).toBe(true)
      expect(workflow2Entry?.isCanceled).toBeUndefined()
    })
  })
})
