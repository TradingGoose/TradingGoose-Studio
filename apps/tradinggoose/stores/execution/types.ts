export interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  autoPanDisabled: boolean
}

export interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setPendingBlocks: (blockIds: string[]) => void
  setAutoPanDisabled: (disabled: boolean) => void
  reset: () => void
}

export const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  autoPanDisabled: false,
}

// Types for panning functionality
export type PanToBlockCallback = (blockId: string) => void
export type SetPanToBlockCallback = (callback: PanToBlockCallback | null) => void
