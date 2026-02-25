import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleUpdate } from './types'

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
    useConsoleStore.setState({
      entries: [],
      isOpen: false,
    })
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

  describe('updateConsole', () => {
    beforeEach(() => {
      // Add a test entry first
      const store = useConsoleStore.getState()
      store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Test Block',
        blockType: 'agent',
        success: true,
        output: { content: 'Initial content' },
        durationMs: 100,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })
    })

    it('should update console entry with string content', () => {
      const store = useConsoleStore.getState()

      store.updateConsole('block-123', 'Updated content')

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].output?.content).toBe('Updated content')
    })

    it('should update console entry with object update', () => {
      const store = useConsoleStore.getState()

      const update: ConsoleUpdate = {
        content: 'New content',
        success: false,
        error: 'Update error',
        durationMs: 200,
        endedAt: '2023-01-01T00:00:02.000Z',
      }

      store.updateConsole('block-123', update)

      const state = useConsoleStore.getState()
      const entry = state.entries[0]

      expect(entry.output?.content).toBe('New content')
      expect(entry.success).toBe(false)
      expect(entry.error).toBe('Update error')
      expect(entry.durationMs).toBe(200)
      expect(entry.endedAt).toBe('2023-01-01T00:00:02.000Z')
    })

    it('should update output object directly', () => {
      const store = useConsoleStore.getState()

      const update: ConsoleUpdate = {
        output: {
          content: 'Direct output update',
          status: 200,
        },
      }

      store.updateConsole('block-123', update)

      const state = useConsoleStore.getState()
      const entry = state.entries[0]

      expect(entry.output?.content).toBe('Direct output update')
      expect(entry.output?.status).toBe(200)
    })

    it('should update running and canceled flags', () => {
      const store = useConsoleStore.getState()

      store.updateConsole('block-123', { isRunning: true })
      let state = useConsoleStore.getState()
      expect(state.entries[0].isRunning).toBe(true)

      store.updateConsole('block-123', { isRunning: false, isCanceled: true })
      state = useConsoleStore.getState()
      expect(state.entries[0].isRunning).toBe(false)
      expect(state.entries[0].isCanceled).toBe(true)
    })

    it('should not update non-matching block IDs', () => {
      const store = useConsoleStore.getState()

      store.updateConsole('non-existent-block', 'Should not update')

      const newState = useConsoleStore.getState()
      expect(newState.entries[0].output?.content).toBe('Initial content')
    })

    it('should handle partial updates correctly', () => {
      const store = useConsoleStore.getState()

      // First update only success flag
      store.updateConsole('block-123', { success: false })

      let state = useConsoleStore.getState()
      expect(state.entries[0].success).toBe(false)
      expect(state.entries[0].output?.content).toBe('Initial content') // Should remain unchanged

      // Then update only content
      store.updateConsole('block-123', { content: 'Partial update' })

      state = useConsoleStore.getState()
      expect(state.entries[0].success).toBe(false) // Should remain false
      expect(state.entries[0].output?.content).toBe('Partial update')
    })

    it('should update only the most recent matching entry', () => {
      const store = useConsoleStore.getState()

      const older = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Test Block',
        blockType: 'agent',
        success: true,
        output: { content: 'Older content' },
        durationMs: 50,
        startedAt: '2023-01-01T00:00:02.000Z',
        endedAt: '2023-01-01T00:00:02.050Z',
        executionId: 'exec-1',
      })

      const newer = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Test Block',
        blockType: 'agent',
        success: true,
        output: { content: 'Newer content' },
        durationMs: 60,
        startedAt: '2023-01-01T00:00:03.000Z',
        endedAt: '2023-01-01T00:00:03.060Z',
        executionId: 'exec-1',
      })

      store.updateConsole('block-123', { content: 'Latest update' }, 'exec-1')

      const state = useConsoleStore.getState()
      const updatedNewer = state.entries.find((entry) => entry.id === newer.id)
      const untouchedOlder = state.entries.find((entry) => entry.id === older.id)

      expect(updatedNewer?.output?.content).toBe('Latest update')
      expect(untouchedOlder?.output?.content).toBe('Older content')
    })
  })

  describe('updateConsoleEntry', () => {
    it('should update only the matching entry by id', () => {
      const store = useConsoleStore.getState()
      const first = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'agent',
        success: true,
        output: { content: 'First' },
        durationMs: 10,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      const second = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'agent',
        success: true,
        output: { content: 'Second' },
        durationMs: 10,
        startedAt: '2023-01-01T00:00:02.000Z',
        endedAt: '2023-01-01T00:00:03.000Z',
      })

      store.updateConsoleEntry(first.id, { content: 'Updated' })

      const state = useConsoleStore.getState()
      const updatedFirst = state.entries.find((entry) => entry.id === first.id)
      const untouchedSecond = state.entries.find((entry) => entry.id === second.id)

      expect(updatedFirst?.output?.content).toBe('Updated')
      expect(untouchedSecond?.output?.content).toBe('Second')
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
  })

  describe('getWorkflowEntries', () => {
    beforeEach(() => {
      const store = useConsoleStore.getState()

      // Add entries for different workflows
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

      store.addConsole({
        workflowId: 'workflow-1',
        blockId: 'block-3',
        blockName: 'Block 3',
        blockType: 'function',
        success: false,
        output: {},
        error: 'Test error',
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })
    })

    it('should return entries for specific workflow', () => {
      const store = useConsoleStore.getState()

      const workflow1Entries = store.getWorkflowEntries('workflow-1')
      const workflow2Entries = store.getWorkflowEntries('workflow-2')

      expect(workflow1Entries).toHaveLength(2)
      expect(workflow2Entries).toHaveLength(1)

      expect(workflow1Entries.every((entry) => entry.workflowId === 'workflow-1')).toBe(true)
      expect(workflow2Entries.every((entry) => entry.workflowId === 'workflow-2')).toBe(true)
    })

    it('should return empty array for non-existent workflow', () => {
      const store = useConsoleStore.getState()

      const entries = store.getWorkflowEntries('non-existent-workflow')

      expect(entries).toHaveLength(0)
    })
  })

  describe('toggleConsole', () => {
    it('should toggle console open state', () => {
      const store = useConsoleStore.getState()

      expect(store.isOpen).toBe(false)

      store.toggleConsole()
      expect(useConsoleStore.getState().isOpen).toBe(true)

      store.toggleConsole()
      expect(useConsoleStore.getState().isOpen).toBe(false)
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
