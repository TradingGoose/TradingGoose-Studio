import type React from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { getBlock } from '@/blocks'
import type { ConsoleEntry } from '@/stores/console/types'
import type { EntryNode, ExecutionGroup, SortConfig, TerminalFilters } from './types'

const SUBFLOW_COLORS = {
  loop: '#2FB3FF',
  parallel: '#FEE12B',
} as const

export function getBlockIcon(
  blockType: string
): React.ComponentType<{ className?: string }> | null {
  const blockConfig = getBlock(blockType)

  if (blockConfig?.icon) {
    return blockConfig.icon
  }

  if (blockType === 'loop') {
    return RepeatIcon
  }

  if (blockType === 'parallel') {
    return SplitIcon
  }

  return null
}

export function getBlockColor(blockType: string): string {
  const blockConfig = getBlock(blockType)
  const iconColor = sanitizeSolidIconColor(blockConfig?.bgColor)
  if (iconColor) {
    return iconColor
  }
  if (blockType === 'loop') {
    return SUBFLOW_COLORS.loop
  }
  if (blockType === 'parallel') {
    return SUBFLOW_COLORS.parallel
  }
  return '#6b7280'
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '-'
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

export function filterEntries(
  entries: ConsoleEntry[],
  filters: TerminalFilters,
  sortConfig: SortConfig
): ConsoleEntry[] {
  let result = entries

  if (filters.blockIds.size > 0 || filters.statuses.size > 0) {
    result = entries.filter((entry) => {
      if (filters.blockIds.size > 0 && !filters.blockIds.has(entry.blockId)) {
        return false
      }

      if (filters.statuses.size > 0) {
        const isError = !!entry.error
        const hasStatus = isError ? filters.statuses.has('error') : filters.statuses.has('info')
        if (!hasStatus) return false
      }

      return true
    })
  }

  result = [...result].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime()
    const timeB = new Date(b.timestamp).getTime()
    const comparison = timeA - timeB
    return sortConfig.direction === 'asc' ? comparison : -comparison
  })

  return result
}

interface IterationGroup {
  iterationType: string
  iterationCurrent: number
  iterationTotal?: number
  blocks: ConsoleEntry[]
  startTimeMs: number
}

function buildEntryTree(entries: ConsoleEntry[]): EntryNode[] {
  const regularBlocks: ConsoleEntry[] = []
  const iterationEntries: ConsoleEntry[] = []

  for (const entry of entries) {
    if (entry.iterationType && entry.iterationCurrent !== undefined) {
      iterationEntries.push(entry)
    } else {
      regularBlocks.push(entry)
    }
  }

  const iterationGroupsMap = new Map<string, IterationGroup>()
  for (const entry of iterationEntries) {
    const key = `${entry.iterationType}-${entry.iterationCurrent}`
    let group = iterationGroupsMap.get(key)
    const entryStartMs = new Date(entry.startedAt || entry.timestamp).getTime()

    if (!group) {
      group = {
        iterationType: entry.iterationType!,
        iterationCurrent: entry.iterationCurrent!,
        iterationTotal: entry.iterationTotal,
        blocks: [],
        startTimeMs: entryStartMs,
      }
      iterationGroupsMap.set(key, group)
    } else {
      if (entryStartMs < group.startTimeMs) {
        group.startTimeMs = entryStartMs
      }
      if (entry.iterationTotal !== undefined) {
        group.iterationTotal = entry.iterationTotal
      }
    }
    group.blocks.push(entry)
  }

  for (const group of iterationGroupsMap.values()) {
    group.blocks.sort((a, b) => {
      const aStart = new Date(a.startedAt || a.timestamp).getTime()
      const bStart = new Date(b.startedAt || b.timestamp).getTime()
      return aStart - bStart
    })
  }

  const subflowGroups = new Map<string, IterationGroup[]>()
  for (const group of iterationGroupsMap.values()) {
    const type = group.iterationType
    let groups = subflowGroups.get(type)
    if (!groups) {
      groups = []
      subflowGroups.set(type, groups)
    }
    groups.push(group)
  }

  for (const groups of subflowGroups.values()) {
    groups.sort((a, b) => a.iterationCurrent - b.iterationCurrent)
  }

  const subflowNodes: EntryNode[] = []
  for (const [iterationType, iterationGroups] of subflowGroups.entries()) {
    const firstIteration = iterationGroups[0]
    const allBlocks = iterationGroups.flatMap((g) => g.blocks)
    const subflowStartMs = Math.min(
      ...allBlocks.map((b) => new Date(b.startedAt || b.timestamp).getTime())
    )
    const subflowEndMs = Math.max(
      ...allBlocks.map((b) => new Date(b.endedAt || b.timestamp).getTime())
    )
    const totalDuration = allBlocks.reduce((sum, b) => sum + (b.durationMs || 0), 0)

    const syntheticSubflow: ConsoleEntry = {
      id: `subflow-${iterationType}-${firstIteration.blocks[0]?.executionId || 'unknown'}`,
      timestamp: new Date(subflowStartMs).toISOString(),
      workflowId: firstIteration.blocks[0]?.workflowId || '',
      blockId: `${iterationType}-container`,
      blockName: iterationType.charAt(0).toUpperCase() + iterationType.slice(1),
      blockType: iterationType,
      executionId: firstIteration.blocks[0]?.executionId,
      startedAt: new Date(subflowStartMs).toISOString(),
      endedAt: new Date(subflowEndMs).toISOString(),
      durationMs: totalDuration,
      success: !allBlocks.some((b) => b.error),
    }

    const iterationNodes: EntryNode[] = iterationGroups.map((iterGroup) => {
      const iterBlocks = iterGroup.blocks
      const iterStartMs = Math.min(
        ...iterBlocks.map((b) => new Date(b.startedAt || b.timestamp).getTime())
      )
      const iterEndMs = Math.max(
        ...iterBlocks.map((b) => new Date(b.endedAt || b.timestamp).getTime())
      )
      const iterDuration = iterBlocks.reduce((sum, b) => sum + (b.durationMs || 0), 0)

      const syntheticIteration: ConsoleEntry = {
        id: `iteration-${iterationType}-${iterGroup.iterationCurrent}-${iterBlocks[0]?.executionId || 'unknown'}`,
        timestamp: new Date(iterStartMs).toISOString(),
        workflowId: iterBlocks[0]?.workflowId || '',
        blockId: `iteration-${iterGroup.iterationCurrent}`,
        blockName: `Iteration ${iterGroup.iterationCurrent}${iterGroup.iterationTotal !== undefined ? ` / ${iterGroup.iterationTotal}` : ''}`,
        blockType: iterationType,
        executionId: iterBlocks[0]?.executionId,
        startedAt: new Date(iterStartMs).toISOString(),
        endedAt: new Date(iterEndMs).toISOString(),
        durationMs: iterDuration,
        success: !iterBlocks.some((b) => b.error),
        iterationCurrent: iterGroup.iterationCurrent,
        iterationTotal: iterGroup.iterationTotal,
        iterationType: iterationType as 'loop' | 'parallel',
      }

      const blockNodes: EntryNode[] = iterBlocks.map((block) => ({
        entry: block,
        children: [],
        nodeType: 'block' as const,
      }))

      return {
        entry: syntheticIteration,
        children: blockNodes,
        nodeType: 'iteration' as const,
        iterationInfo: {
          current: iterGroup.iterationCurrent,
          total: iterGroup.iterationTotal,
        },
      }
    })

    subflowNodes.push({
      entry: syntheticSubflow,
      children: iterationNodes,
      nodeType: 'subflow' as const,
    })
  }

  const regularNodes: EntryNode[] = regularBlocks.map((entry) => ({
    entry,
    children: [],
    nodeType: 'block' as const,
  }))

  const allNodes = [...subflowNodes, ...regularNodes]
  allNodes.sort((a, b) => {
    const aStart = new Date(a.entry.startedAt || a.entry.timestamp).getTime()
    const bStart = new Date(b.entry.startedAt || b.entry.timestamp).getTime()
    return aStart - bStart
  })

  return allNodes
}

export function groupEntriesByExecution(entries: ConsoleEntry[]): ExecutionGroup[] {
  const groups = new Map<
    string,
    { meta: Omit<ExecutionGroup, 'entryTree'>; entries: ConsoleEntry[] }
  >()

  for (const entry of entries) {
    const execId = entry.executionId || entry.id
    const entryStartTime = entry.startedAt || entry.timestamp
    const entryEndTime = entry.endedAt || entry.timestamp
    const entryStartMs = new Date(entryStartTime).getTime()
    const entryEndMs = new Date(entryEndTime).getTime()

    let group = groups.get(execId)

    if (!group) {
      group = {
        meta: {
          executionId: execId,
          startTime: entryStartTime,
          endTime: entryEndTime,
          startTimeMs: entryStartMs,
          endTimeMs: entryEndMs,
          duration: 0,
          status: 'success',
          entries: [],
        },
        entries: [],
      }
      groups.set(execId, group)
    } else {
      if (entryStartMs < group.meta.startTimeMs) {
        group.meta.startTime = entryStartTime
        group.meta.startTimeMs = entryStartMs
      }
      if (entryEndMs > group.meta.endTimeMs) {
        group.meta.endTime = entryEndTime
        group.meta.endTimeMs = entryEndMs
      }
    }

    if (entry.error) {
      group.meta.status = 'error'
    }

    group.entries.push(entry)
  }

  const result: ExecutionGroup[] = []
  for (const group of groups.values()) {
    group.meta.duration = group.meta.endTimeMs - group.meta.startTimeMs
    group.meta.entries = group.entries
    result.push({
      ...group.meta,
      entryTree: buildEntryTree(group.entries),
    })
  }

  result.sort((a, b) => b.startTimeMs - a.startTimeMs)

  return result
}
