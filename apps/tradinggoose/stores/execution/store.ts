import { createWithEqualityFn as create } from 'zustand/traditional'
import {
  createInitialWorkflowExecutionState,
  type ExecutionActions,
  type ExecutionState,
  initialState,
  type PanToBlockCallback,
  type SetPanToBlockCallback,
  type WorkflowExecutionState,
} from '@/stores/execution/types'

const panToBlockCallbacks = new Map<string, PanToBlockCallback>()
const EMPTY_WORKFLOW_EXECUTION_STATE = createInitialWorkflowExecutionState()

export const setPanToBlockCallback: SetPanToBlockCallback = (workflowId, callback) => {
  if (!workflowId) return
  if (callback) {
    panToBlockCallbacks.set(workflowId, callback)
    return
  }
  panToBlockCallbacks.delete(workflowId)
}

export function selectWorkflowExecutionState(
  state: ExecutionState,
  workflowId: string | null | undefined
): WorkflowExecutionState {
  if (!workflowId) {
    return EMPTY_WORKFLOW_EXECUTION_STATE
  }
  return state.byWorkflowId[workflowId] ?? EMPTY_WORKFLOW_EXECUTION_STATE
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set, get) => ({
  ...initialState,

  setActiveBlocks: (workflowId, blockIds) => {
    if (!workflowId) return

    set((state) => {
      const current = selectWorkflowExecutionState(state, workflowId)
      return {
        byWorkflowId: {
          ...state.byWorkflowId,
          [workflowId]: {
            ...current,
            activeBlockIds: new Set(blockIds),
          },
        },
      }
    })

    // Auto-pan is always enabled by default unless the execution session disables it.
    const { autoPanDisabled } = selectWorkflowExecutionState(get(), workflowId)
    const panToBlockCallback = panToBlockCallbacks.get(workflowId)

    if (panToBlockCallback && !autoPanDisabled && blockIds.size > 0) {
      const firstActiveBlockId = Array.from(blockIds)[0]
      panToBlockCallback(firstActiveBlockId)
    }
  },

  setPendingBlocks: (workflowId, pendingBlocks) => {
    if (!workflowId) return

    set((state) => {
      const current = selectWorkflowExecutionState(state, workflowId)
      return {
        byWorkflowId: {
          ...state.byWorkflowId,
          [workflowId]: {
            ...current,
            pendingBlocks,
          },
        },
      }
    })

    // Auto-pan is always enabled by default unless the execution session disables it.
    const { isDebugging, autoPanDisabled } = selectWorkflowExecutionState(get(), workflowId)
    const panToBlockCallback = panToBlockCallbacks.get(workflowId)

    if (panToBlockCallback && !autoPanDisabled && pendingBlocks.length > 0 && isDebugging) {
      const firstPendingBlockId = pendingBlocks[0]
      panToBlockCallback(firstPendingBlockId)
    }
  },

  setIsExecuting: (workflowId, isExecuting) => {
    if (!workflowId) return

    set((state) => {
      const current = selectWorkflowExecutionState(state, workflowId)
      return {
        byWorkflowId: {
          ...state.byWorkflowId,
          [workflowId]: {
            ...current,
            isExecuting,
            autoPanDisabled: isExecuting ? false : current.autoPanDisabled,
          },
        },
      }
    })
  },

  setIsDebugging: (workflowId, isDebugging) => {
    if (!workflowId) return
    set((state) => {
      const current = selectWorkflowExecutionState(state, workflowId)
      return {
        byWorkflowId: {
          ...state.byWorkflowId,
          [workflowId]: {
            ...current,
            isDebugging,
          },
        },
      }
    })
  },

  setAutoPanDisabled: (workflowId, disabled) => {
    if (!workflowId) return
    set((state) => {
      const current = selectWorkflowExecutionState(state, workflowId)
      return {
        byWorkflowId: {
          ...state.byWorkflowId,
          [workflowId]: {
            ...current,
            autoPanDisabled: disabled,
          },
        },
      }
    })
  },

  resetWorkflowExecution: (workflowId) => {
    if (!workflowId) return
    set((state) => ({
      byWorkflowId: {
        ...state.byWorkflowId,
        [workflowId]: createInitialWorkflowExecutionState(),
      },
    }))
  },
  reset: () => set(initialState),
}))
