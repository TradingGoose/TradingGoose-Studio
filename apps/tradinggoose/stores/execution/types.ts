export interface ExecutionState {
  byWorkflowId: Record<string, WorkflowExecutionState>
}

export interface WorkflowExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  autoPanDisabled: boolean
}

export interface ExecutionActions {
  setActiveBlocks: (workflowId: string, blockIds: Set<string>) => void
  setIsExecuting: (workflowId: string, isExecuting: boolean) => void
  setIsDebugging: (workflowId: string, isDebugging: boolean) => void
  setPendingBlocks: (workflowId: string, blockIds: string[]) => void
  setAutoPanDisabled: (workflowId: string, disabled: boolean) => void
  resetWorkflowExecution: (workflowId: string) => void
  reset: () => void
}

export const createInitialWorkflowExecutionState = (): WorkflowExecutionState => ({
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  autoPanDisabled: false,
})

export const initialState: ExecutionState = {
  byWorkflowId: {},
}

// Types for panning functionality
export type PanToBlockCallback = (blockId: string) => void
export type SetPanToBlockCallback = (
  workflowId: string,
  callback: PanToBlockCallback | null
) => void
