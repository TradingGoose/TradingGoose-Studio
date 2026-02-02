import type { NormalizedBlockOutput } from '@/executor/types'

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

export interface ConsoleUpdate {
  content?: string
  input?: any
  output?: Partial<NormalizedBlockOutput>
  replaceOutput?: NormalizedBlockOutput // New field for complete replacement
  error?: string
  warning?: string
  success?: boolean
  endedAt?: string
  durationMs?: number
  /** Whether this block is currently running */
  isRunning?: boolean
  /** Whether this block execution was canceled */
  isCanceled?: boolean
  /** Iteration context for loops and parallels */
  iterationCurrent?: number
  iterationTotal?: number
  iterationType?: 'loop' | 'parallel'
}

export interface ConsoleStore {
  entries: ConsoleEntry[]
  isOpen: boolean

  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry
  clearConsole: (workflowId: string | null) => void
  exportConsoleCSV: (workflowId: string) => void
  getWorkflowEntries: (workflowId: string) => ConsoleEntry[]
  toggleConsole: () => void
  updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => void
  updateConsoleEntry: (entryId: string, update: string | ConsoleUpdate) => void
  cancelRunningEntries: (workflowId: string) => void
}
