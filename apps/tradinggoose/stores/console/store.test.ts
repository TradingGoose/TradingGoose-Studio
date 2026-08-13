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

    it('terminalizes only running entries from the matching execution after a deadline error', () => {
      const store = useConsoleStore.getState()
      const deadlineError =
        'Workflow execution stopped because it reached the 20-second Workflow Execution Time Limit for the "Pro" tier.'
      const startBlock = (executionId: string, workflowId: string, blockId: string) =>
        store.ingestWorkflowExecutionEvent({
          executionId,
          workflowId,
          timestamp: '2026-08-07T15:16:14.200Z',
          type: 'block:started',
          data: {
            blockId,
            blockName: 'Wait',
            blockType: 'wait',
            startedAt: '2026-08-07T15:16:14.200Z',
          },
        })

      startBlock('exec-deadline', 'workflow-1', 'wait-1')
      startBlock('exec-deadline', 'workflow-1', 'wait-1b')
      startBlock('exec-concurrent', 'workflow-1', 'wait-2')
      startBlock('exec-other', 'workflow-2', 'wait-3')

      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-deadline',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:35.000Z',
        type: 'execution:error',
        data: {
          error: deadlineError,
          result: {
            success: false,
            output: {},
            error: deadlineError,
            code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
            deadline: {
              appliedTierId: 'tier-pro',
              appliedTierName: 'Pro',
              limitSeconds: 20,
              processingStartedAt: '2026-08-07T15:16:14.200Z',
              terminatedAt: '2026-08-07T15:16:34.200Z',
            },
            logs: [
              {
                blockId: 'wait-1',
                blockName: 'Wait',
                blockType: 'wait',
                startedAt: '2026-08-07T15:16:14.200Z',
                endedAt: '2026-08-07T15:16:34.200Z',
                durationMs: 20_000,
                success: false,
                error: deadlineError,
                code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
              },
              {
                blockId: 'wait-1b',
                blockName: 'Wait',
                blockType: 'wait',
                startedAt: '2026-08-07T15:16:14.200Z',
                endedAt: '2026-08-07T15:16:34.200Z',
                durationMs: 20_000,
                success: false,
                error: deadlineError,
                code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
              },
            ],
          },
        },
      })

      const entries = useConsoleStore.getState().entries
      const expired = entries.filter((entry) => entry.executionId === 'exec-deadline')
      expect(expired).toHaveLength(2)
      for (const entry of expired) {
        expect(entry).toMatchObject({
          success: false,
          error: deadlineError,
          isRunning: false,
          isCanceled: false,
          endedAt: '2026-08-07T15:16:34.200Z',
          durationMs: 20_000,
        })
      }
      expect(entries.find((entry) => entry.executionId === 'exec-concurrent')?.isRunning).toBe(true)
      expect(entries.find((entry) => entry.executionId === 'exec-other')?.isRunning).toBe(true)
      expect(
        entries.some(
          (entry) => entry.executionId === 'exec-deadline' && entry.blockId === 'execution'
        )
      ).toBe(false)

      const persisted = vi.mocked(global.localStorage.setItem).mock.calls.at(-1)?.[1]
      expect(persisted).toBeDefined()
      expect(JSON.parse(persisted!)).toMatchObject({
        state: {
          entries: expect.arrayContaining([
            expect.objectContaining({
              executionId: 'exec-deadline',
              error: deadlineError,
              isRunning: false,
              isCanceled: false,
              endedAt: '2026-08-07T15:16:34.200Z',
              durationMs: 20_000,
            }),
          ]),
        },
      })
    })

    it('creates one deadline failure entry when execution ends before a block starts', () => {
      const store = useConsoleStore.getState()
      const deadlineError =
        'Workflow execution stopped because it reached the 20-second Workflow Execution Time Limit for the "Pro" tier.'
      const event = {
        executionId: 'exec-before-block',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:34.200Z',
        type: 'execution:error' as const,
        data: {
          error: deadlineError,
          result: {
            success: false,
            output: {},
            error: deadlineError,
            code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
            deadline: {
              appliedTierId: 'tier-pro',
              appliedTierName: 'Pro',
              limitSeconds: 20,
              processingStartedAt: '2026-08-07T15:16:14.200Z',
              terminatedAt: '2026-08-07T15:16:34.200Z',
            },
            logs: [],
          },
        },
      }

      store.ingestWorkflowExecutionEvent(event)
      store.ingestWorkflowExecutionEvent(event)

      const entries = useConsoleStore
        .getState()
        .entries.filter((entry) => entry.executionId === 'exec-before-block')
      expect(entries).toEqual([
        expect.objectContaining({
          workflowId: 'workflow-1',
          executionId: 'exec-before-block',
          blockId: 'execution',
          blockName: 'Workflow',
          blockType: 'workflow',
          error: deadlineError,
          success: false,
          isRunning: false,
          isCanceled: false,
          startedAt: '2026-08-07T15:16:14.200Z',
          endedAt: '2026-08-07T15:16:34.200Z',
          durationMs: 20_000,
        }),
      ])
      const persisted = vi.mocked(global.localStorage.setItem).mock.calls.at(-1)?.[1]
      expect(JSON.parse(persisted!)).toMatchObject({
        state: {
          entries: expect.arrayContaining([
            expect.objectContaining({
              executionId: 'exec-before-block',
              blockId: 'execution',
              error: deadlineError,
            }),
          ]),
        },
      })
    })

    it('rebuilds durable block history from a terminal-only deadline replay', () => {
      const store = useConsoleStore.getState()
      const deadlineError =
        'Workflow execution stopped because it reached the 20-second Workflow Execution Time Limit for the "Pro" tier.'
      const event = {
        executionId: 'exec-replayed-deadline',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:35.000Z',
        type: 'execution:error' as const,
        data: {
          error: deadlineError,
          result: {
            success: false,
            output: {},
            error: deadlineError,
            code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
            deadline: {
              appliedTierId: 'tier-pro',
              appliedTierName: 'Pro',
              limitSeconds: 20,
              processingStartedAt: '2026-08-07T15:16:14.200Z',
              terminatedAt: '2026-08-07T15:16:34.200Z',
            },
            logs: [
              {
                blockId: 'api-1',
                blockName: 'API',
                blockType: 'api',
                startedAt: '2026-08-07T15:16:14.200Z',
                endedAt: '2026-08-07T15:16:15.200Z',
                durationMs: 1_000,
                success: true,
              },
              {
                blockId: 'wait-1',
                blockName: 'Wait',
                blockType: 'wait',
                startedAt: '2026-08-07T15:16:15.200Z',
                endedAt: '2026-08-07T15:16:34.200Z',
                durationMs: 19_000,
                success: false,
                error: deadlineError,
                code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
              },
            ],
          },
        },
      }

      store.ingestWorkflowExecutionEvent(event)
      store.ingestWorkflowExecutionEvent(event)

      const entries = useConsoleStore
        .getState()
        .entries.filter((entry) => entry.executionId === 'exec-replayed-deadline')
      expect(entries).toHaveLength(2)
      expect(entries).toEqual([
        expect.objectContaining({
          blockId: 'api-1',
          success: true,
          endedAt: '2026-08-07T15:16:15.200Z',
          durationMs: 1_000,
        }),
        expect.objectContaining({
          blockId: 'wait-1',
          success: false,
          code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
          deadline: expect.objectContaining({ appliedTierName: 'Pro', limitSeconds: 20 }),
          endedAt: '2026-08-07T15:16:34.200Z',
          durationMs: 19_000,
        }),
      ])
    })

    it('adds a deadline failure entry when prior blocks completed successfully', () => {
      const store = useConsoleStore.getState()
      const deadlineError =
        'Workflow execution stopped because it reached the 20-second Workflow Execution Time Limit for the "Pro" tier.'
      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-between-blocks',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:14.200Z',
        type: 'block:completed',
        data: {
          blockId: 'api-1',
          blockName: 'API',
          blockType: 'api',
          startedAt: '2026-08-07T15:16:14.200Z',
          endedAt: '2026-08-07T15:16:15.200Z',
          durationMs: 1_000,
        },
      })
      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-between-blocks',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:34.200Z',
        type: 'execution:error',
        data: {
          error: deadlineError,
          result: {
            success: false,
            output: {},
            error: deadlineError,
            code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
            deadline: {
              appliedTierId: 'tier-pro',
              appliedTierName: 'Pro',
              limitSeconds: 20,
              processingStartedAt: '2026-08-07T15:16:14.200Z',
              terminatedAt: '2026-08-07T15:16:34.200Z',
            },
            logs: [
              {
                blockId: 'api-1',
                blockName: 'API',
                blockType: 'api',
                startedAt: '2026-08-07T15:16:14.200Z',
                endedAt: '2026-08-07T15:16:15.200Z',
                durationMs: 1_000,
                success: true,
              },
            ],
          },
        },
      })

      const entries = useConsoleStore
        .getState()
        .entries.filter((entry) => entry.executionId === 'exec-between-blocks')
      expect(entries).toHaveLength(2)
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ blockId: 'api-1', success: true }),
          expect.objectContaining({
            blockId: 'execution',
            success: false,
            error: deadlineError,
          }),
        ])
      )
    })

    it.each([
      ['execution:completed', true, false],
      ['execution:cancelled', false, true],
    ] as const)('classifies running entries closed by %s', (type, success, isCanceled) => {
      const store = useConsoleStore.getState()
      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-terminal',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:14.200Z',
        type: 'block:started',
        data: {
          blockId: 'wait-1',
          blockName: 'Wait',
          blockType: 'wait',
          startedAt: '2026-08-07T15:16:14.200Z',
        },
      })

      store.ingestWorkflowExecutionEvent({
        executionId: 'exec-terminal',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:15.200Z',
        type,
        data: { result: { success, output: {} } },
      })

      expect(useConsoleStore.getState().entries[0]).toMatchObject({
        success,
        isRunning: false,
        isCanceled,
        endedAt: '2026-08-07T15:16:15.200Z',
        durationMs: 1000,
      })
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
