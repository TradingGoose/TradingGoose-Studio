import { create } from 'zustand'
import {
  type ExecutionActions,
  type ExecutionState,
  initialState,
  type PanToBlockCallback,
  type SetPanToBlockCallback,
} from '@/stores/execution/types'

// Global callback for panning to active blocks
let panToBlockCallback: PanToBlockCallback | null = null

export const setPanToBlockCallback: SetPanToBlockCallback = (callback) => {
  panToBlockCallback = callback
}

export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set, get) => ({
  ...initialState,

  setActiveBlocks: (blockIds) => {
    set({ activeBlockIds: new Set(blockIds) })

    // Auto-pan is always enabled by default unless the execution session disables it.
    const { autoPanDisabled } = get()

    if (panToBlockCallback && !autoPanDisabled && blockIds.size > 0) {
      const firstActiveBlockId = Array.from(blockIds)[0]
      panToBlockCallback(firstActiveBlockId)
    }
  },

  setPendingBlocks: (pendingBlocks) => {
    set({ pendingBlocks })

    // Auto-pan is always enabled by default unless the execution session disables it.
    const { isDebugging, autoPanDisabled } = get()

    if (panToBlockCallback && !autoPanDisabled && pendingBlocks.length > 0 && isDebugging) {
      const firstPendingBlockId = pendingBlocks[0]
      panToBlockCallback(firstPendingBlockId)
    }
  },

  setIsExecuting: (isExecuting) => {
    set({ isExecuting })
    // Reset auto-pan disabled state when starting execution
    if (isExecuting) {
      set({ autoPanDisabled: false })
    }
  },
  setIsDebugging: (isDebugging) => set({ isDebugging }),
  setExecutor: (executor) => set({ executor }),
  setDebugContext: (debugContext) => set({ debugContext }),
  setAutoPanDisabled: (disabled) => set({ autoPanDisabled: disabled }),
  reset: () => set(initialState),
}))
