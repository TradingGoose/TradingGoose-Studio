import type { ConsoleEntry } from '@/stores/panel/console/types'

export interface TerminalFilters {
  blockIds: Set<string>
  statuses: Set<'error' | 'info'>
}

export type SortField = 'timestamp'
export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  field: SortField
  direction: SortDirection
}

export type EntryStatus = 'error' | 'info'

export interface BlockInfo {
  blockId: string
  blockName: string
  blockType: string
}

export type EntryNodeType = 'block' | 'subflow' | 'iteration'

export interface EntryNode {
  entry: ConsoleEntry
  children: EntryNode[]
  nodeType: EntryNodeType
  iterationInfo?: {
    current: number
    total?: number
  }
}

export interface ExecutionGroup {
  executionId: string
  startTime: string
  endTime: string
  startTimeMs: number
  endTimeMs: number
  duration: number
  status: 'success' | 'error'
  entries: ConsoleEntry[]
  entryTree: EntryNode[]
}

export const ROW_STYLES = {
  base: 'group flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1',
  selected: 'bg-muted',
  hover: 'hover:bg-muted/60',
  nested: 'mt-1 ml-3 flex min-w-0 flex-col gap-1 border-l border-border pl-3',
  iconButton: 'h-6 w-6 p-0',
} as const
