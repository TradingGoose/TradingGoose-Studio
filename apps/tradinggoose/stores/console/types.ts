import type { NormalizedBlockOutput } from '@/executor/types'
import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'

export interface ConsoleEntry {
  id: string
  timestamp: string
  workflowId: string
  blockId: string
  executionId?: string
  blockName?: string
  blockType?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  success: boolean
  output?: NormalizedBlockOutput
  input?: any
  error?: string
  warning?: string
  // Iteration context for loops and parallels
  iterationCurrent?: number
  iterationTotal?: number
  iterationType?: 'loop' | 'parallel'
  /** Whether this block is currently running */
  isRunning?: boolean
  /** Whether this block execution was canceled */
  isCanceled?: boolean
}

export interface ConsoleStore {
  entries: ConsoleEntry[]

  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry
  clearConsole: (workflowId: string | null) => void
  exportConsoleCSV: (workflowId: string) => void
  ingestWorkflowExecutionEvent: (event: WorkflowExecutionEvent) => void
  cancelRunningEntries: (workflowId: string) => void
}
