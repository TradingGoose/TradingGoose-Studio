'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useConsoleStore } from '@/stores/panel/console/store'
import type { ConsoleEntry } from '@/stores/panel/console/types'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { OutputPanel, StatusDisplay } from './components'
import type { EntryNode, ExecutionGroup } from './types'
import { ROW_STYLES } from './types'
import { useWorkflowConsoleUiState } from './terminal-ui-store'
import {
  filterEntries,
  formatDuration,
  getBlockColor,
  getBlockIcon,
  groupEntriesByExecution,
} from './utils'

interface TerminalProps {
  panelWidth?: number
  hideScrollbar?: boolean
  uiKey?: string
}

const BlockRow = memo(function BlockRow({
  entry,
  isSelected,
  onSelect,
}: {
  entry: ConsoleEntry
  isSelected: boolean
  onSelect: (entry: ConsoleEntry) => void
}) {
  const blockType = entry.blockType || 'unknown'
  const BlockIcon = getBlockIcon(blockType)
  const hasError = Boolean(entry.error)
  const isRunning = Boolean(entry.isRunning)
  const isCanceled = Boolean(entry.isCanceled)
  const bgColor = getBlockColor(blockType)

  return (
    <div
      data-entry-id={entry.id}
      className={cn(
        ROW_STYLES.base,
        isSelected ? ROW_STYLES.selected : ROW_STYLES.hover
      )}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(entry)
      }}
    >
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <div
          className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs bg-secondary text-foreground'
          style={{
            backgroundColor: bgColor ? `${bgColor}20` : undefined,
            color: bgColor || undefined,
          }}
        >
          {BlockIcon && <BlockIcon className='h-4 w-4' />}
        </div>
        <span
          className={cn(
            'min-w-0 truncate text-sm font-medium',
            hasError
              ? 'text-destructive'
              : isSelected
                ? 'text-foreground'
                : 'text-muted-foreground group-hover:text-foreground'
          )}
        >
          {entry.blockName || entry.blockId}
        </span>
      </div>
      <div className='flex-shrink-0'>
        <StatusDisplay
          isRunning={isRunning}
          isCanceled={isCanceled}
          formattedDuration={formatDuration(entry.durationMs)}
        />
      </div>
    </div>
  )
})

const IterationNodeRow = memo(function IterationNodeRow({
  node,
  selectedEntryId,
  onSelectEntry,
  isExpanded,
  onToggle,
}: {
  node: EntryNode
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const { entry, children, iterationInfo } = node
  const hasError = Boolean(entry.error) || children.some((c) => c.entry.error)
  const hasChildren = children.length > 0
  const hasRunningChild = children.some((c) => c.entry.isRunning)
  const hasCanceledChild = children.some((c) => c.entry.isCanceled) && !hasRunningChild

  const iterationLabel = iterationInfo
    ? `Iteration ${iterationInfo.current}${iterationInfo.total !== undefined ? ` / ${iterationInfo.total}` : ''}`
    : entry.blockName

  return (
    <div className='flex min-w-0 flex-col'>
      <div
        className={cn(ROW_STYLES.base, ROW_STYLES.hover)}
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              hasError ? 'text-destructive' : 'text-muted-foreground group-hover:text-foreground'
            )}
          >
            {iterationLabel}
          </span>
          {hasChildren && (
            <ChevronDown
              className={cn(
                'h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform',
                !isExpanded && '-rotate-90'
              )}
            />
          )}
        </div>
        <StatusDisplay
          isRunning={hasRunningChild}
          isCanceled={hasCanceledChild}
          formattedDuration={formatDuration(entry.durationMs)}
        />
      </div>
      {isExpanded && hasChildren && (
        <div className={ROW_STYLES.nested}>
          {children.map((child) => (
            <BlockRow
              key={child.entry.id}
              entry={child.entry}
              isSelected={selectedEntryId === child.entry.id}
              onSelect={onSelectEntry}
            />
          ))}
        </div>
      )}
    </div>
  )
})

const SubflowNodeRow = memo(function SubflowNodeRow({
  node,
  selectedEntryId,
  onSelectEntry,
  expandedNodes,
  onToggleNode,
}: {
  node: EntryNode
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  expandedNodes: Set<string>
  onToggleNode: (nodeId: string) => void
}) {
  const { entry, children } = node
  const blockType = entry.blockType || 'unknown'
  const BlockIcon = getBlockIcon(blockType)
  const hasError =
    Boolean(entry.error) ||
    children.some((c) => c.entry.error || c.children.some((gc) => gc.entry.error))
  const bgColor = getBlockColor(blockType)
  const nodeId = entry.id
  const isExpanded = expandedNodes.has(nodeId)
  const hasChildren = children.length > 0

  const hasRunningDescendant = children.some(
    (c) => c.entry.isRunning || c.children.some((gc) => gc.entry.isRunning)
  )
  const hasCanceledDescendant =
    children.some((c) => c.entry.isCanceled || c.children.some((gc) => gc.entry.isCanceled)) &&
    !hasRunningDescendant

  const displayName =
    entry.blockType === 'loop'
      ? 'Loop'
      : entry.blockType === 'parallel'
        ? 'Parallel'
        : entry.blockName

  return (
    <div className='flex min-w-0 flex-col'>
      <div
        className={cn(ROW_STYLES.base, ROW_STYLES.hover)}
        onClick={(event) => {
          event.stopPropagation()
          onToggleNode(nodeId)
        }}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <div
            className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs bg-secondary text-foreground'
            style={{
              backgroundColor: bgColor ? `${bgColor}20` : undefined,
              color: bgColor || undefined,
            }}
          >
            {BlockIcon && <BlockIcon className='h-4 w-4' />}
          </div>
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              hasError
                ? 'text-destructive'
                : isExpanded
                  ? 'text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'
            )}
          >
            {displayName}
          </span>
          {hasChildren && (
            <ChevronDown
              className={cn(
                'h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform',
                !isExpanded && '-rotate-90'
              )}
            />
          )}
        </div>
        <StatusDisplay
          isRunning={hasRunningDescendant}
          isCanceled={hasCanceledDescendant}
          formattedDuration={formatDuration(entry.durationMs)}
        />
      </div>
      {isExpanded && hasChildren && (
        <div className={ROW_STYLES.nested}>
          {children.map((iterNode) => (
            <IterationNodeRow
              key={iterNode.entry.id}
              node={iterNode}
              selectedEntryId={selectedEntryId}
              onSelectEntry={onSelectEntry}
              isExpanded={expandedNodes.has(iterNode.entry.id)}
              onToggle={() => onToggleNode(iterNode.entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
})

const EntryNodeRow = memo(function EntryNodeRow({
  node,
  selectedEntryId,
  onSelectEntry,
  expandedNodes,
  onToggleNode,
}: {
  node: EntryNode
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  expandedNodes: Set<string>
  onToggleNode: (nodeId: string) => void
}) {
  const { nodeType } = node

  if (nodeType === 'subflow') {
    return (
      <SubflowNodeRow
        node={node}
        selectedEntryId={selectedEntryId}
        onSelectEntry={onSelectEntry}
        expandedNodes={expandedNodes}
        onToggleNode={onToggleNode}
      />
    )
  }

  if (nodeType === 'iteration') {
    return (
      <IterationNodeRow
        node={node}
        selectedEntryId={selectedEntryId}
        onSelectEntry={onSelectEntry}
        isExpanded={expandedNodes.has(node.entry.id)}
        onToggle={() => onToggleNode(node.entry.id)}
      />
    )
  }

  return (
    <BlockRow
      entry={node.entry}
      isSelected={selectedEntryId === node.entry.id}
      onSelect={onSelectEntry}
    />
  )
})

const ExecutionGroupRow = memo(function ExecutionGroupRow({
  group,
  showSeparator,
  selectedEntryId,
  onSelectEntry,
  expandedNodes,
  onToggleNode,
}: {
  group: ExecutionGroup
  showSeparator: boolean
  selectedEntryId: string | null
  onSelectEntry: (entry: ConsoleEntry) => void
  expandedNodes: Set<string>
  onToggleNode: (nodeId: string) => void
}) {
  return (
    <div className='flex flex-col px-2'>
      {showSeparator && <div className='mb-2 border-t border-border' />}
      <div className='flex flex-col gap-1 pb-2'>
        {group.entryTree.map((node) => (
          <EntryNodeRow
            key={node.entry.id}
            node={node}
            selectedEntryId={selectedEntryId}
            onSelectEntry={onSelectEntry}
            expandedNodes={expandedNodes}
            onToggleNode={onToggleNode}
          />
        ))}
      </div>
    </div>
  )
})

export const Terminal = memo(function Terminal({
  panelWidth,
  hideScrollbar = true,
  uiKey,
}: TerminalProps) {
  const entries = useConsoleStore((state) => state.entries)
  const { workflowId } = useWorkflowRoute()
  const resolvedUiKey = uiKey || 'workflow-console'

  const allWorkflowEntries = useMemo(() => {
    return entries.filter((entry) => entry.workflowId === workflowId)
  }, [entries, workflowId])

  const {
    filters,
    sortConfig,
    clearFilters,
    detailView,
    setShowInput,
    toggleStructuredView,
    toggleWrapText,
  } = useWorkflowConsoleUiState(resolvedUiKey)

  const filteredEntries = useMemo(
    () => filterEntries(allWorkflowEntries, filters, sortConfig),
    [allWorkflowEntries, filters, sortConfig]
  )

  const executionGroups = useMemo(
    () => groupEntriesByExecution(filteredEntries),
    [filteredEntries]
  )

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)

  const selectedEntry = useMemo(
    () => allWorkflowEntries.find((entry) => entry.id === selectedEntryId) || null,
    [allWorkflowEntries, selectedEntryId]
  )

  useEffect(() => {
    if (selectedEntryId && !selectedEntry) {
      setSelectedEntryId(null)
    }
  }, [selectedEntryId, selectedEntry])

  useEffect(() => {
    clearFilters()
  }, [clearFilters, workflowId])

  useEffect(() => {
    if (!selectedEntryId && filteredEntries.length > 0) {
      setSelectedEntryId(filteredEntries[0].id)
    }
  }, [filteredEntries, selectedEntryId])

  useEffect(() => {
    if (expandedNodes.size > 0) return

    const next = new Set<string>()
    executionGroups.forEach((group) => {
      const walk = (node: EntryNode) => {
        if (node.children.length > 0) {
          next.add(node.entry.id)
          node.children.forEach(walk)
        }
      }
      group.entryTree.forEach(walk)
    })
    if (next.size > 0) {
      setExpandedNodes(next)
    }
  }, [executionGroups, expandedNodes.size])

  const handleSelectEntry = useCallback((entry: ConsoleEntry) => {
    setSelectedEntryId(entry.id)
  }, [])

  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const leftPanel = (
    <div className='flex h-full flex-col rounded-md border border-border bg-card m-1'>
      <div className='flex-1 overflow-hidden'>
        {executionGroups.length === 0 ? (
          <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
            No logs yet
          </div>
        ) : (
          <ScrollArea
            className={cn('h-full', !hideScrollbar && 'pr-2')}
            hideScrollbar={hideScrollbar}
          >
            <div className={cn('py-2', !hideScrollbar && 'pr-1')}>
              {executionGroups.map((group, index) => (
                <ExecutionGroupRow
                  key={group.executionId}
                  group={group}
                  showSeparator={index > 0}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={handleSelectEntry}
                  expandedNodes={expandedNodes}
                  onToggleNode={handleToggleNode}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )

  const detailState = useMemo(
    () => ({
      showInput: detailView.showInput,
      setShowInput,
      structuredView: detailView.structuredView,
      toggleStructuredView,
      wrapText: detailView.wrapText,
      toggleWrapText,
    }),
    [
      detailView.showInput,
      detailView.structuredView,
      detailView.wrapText,
      setShowInput,
      toggleStructuredView,
      toggleWrapText,
    ]
  )

  const rightPanel = selectedEntry ? (
    <div className='flex h-full flex-col overflow-hidden rounded-md border border-border bg-card m-1'>
      <OutputPanel
        entry={selectedEntry}
        consoleWidth={panelWidth || 0}
        scrollable
        hideScrollbar={hideScrollbar}
        detailState={detailState}
      />
    </div>
  ) : null

  if (!selectedEntry) {
    return <div className='h-full w-full'>{leftPanel}</div>
  }

  const leftPanelSize = panelLayout?.[0] ?? 55
  const rightPanelSize = panelLayout?.[1] ?? 45

  return (
    <ResizablePanelGroup
      direction='horizontal'
      className='h-full w-full'
      onLayout={(sizes) => setPanelLayout(sizes)}
    >
      <ResizablePanel defaultSize={leftPanelSize} minSize={35} className='min-w-0'>
        {leftPanel}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={rightPanelSize} minSize={30} className='min-w-0'>
        {rightPanel}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
})
