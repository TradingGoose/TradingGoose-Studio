'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { formatMonitorDateTime } from '../shared/monitor-time'
import type {
  ExecutionMonitorQuickFilterField,
  ExecutionMonitorVisibleFieldId,
} from '../view/view-config'
import type { MonitorBoardColumn, MonitorBoardSection } from './board-state'
import { type KanbanDragEvent, type KanbanDropDirection, KanbanProvider } from './kanban'
import {
  MonitorKanbanBoard,
  MonitorKanbanCard,
  MonitorKanbanCardHeader,
  MonitorKanbanColumn,
  MonitorKanbanEmptyCard,
  MonitorKanbanFieldChip,
  MonitorKanbanSection,
  MonitorKanbanShell,
} from './monitor-kanban'

type MonitorBoardProps = {
  sections: MonitorBoardSection[]
  selectedExecutionLogId: string | null
  visibleFieldIds: ExecutionMonitorVisibleFieldId[]
  timezone: string
  canReorder: boolean
  onSelectExecution: (logId: string) => void
  onToggleQuickFilter: (field: ExecutionMonitorQuickFilterField, value: string) => void
  isQuickFilterActive: (field: ExecutionMonitorQuickFilterField, value: string) => boolean
  onReorderColumnCards: (columnId: string, nextExecutionIds: string[]) => void
}

type DragState = {
  cardId: string
  columnId: string
} | null

const formatVisibleField = (item: any, field: ExecutionMonitorVisibleFieldId, timezone: string) => {
  switch (field) {
    case 'workflow':
      return item.workflowName
    case 'provider':
      return item.providerId || 'Unknown'
    case 'interval':
      return item.interval || 'Unknown'
    case 'assetType':
      return item.assetType.toUpperCase()
    case 'trigger':
      return item.trigger || 'Unknown'
    case 'startedAt':
      return formatMonitorDateTime(new Date(item.startedAt), timezone)
    case 'endedAt':
      return item.endedAt ? formatMonitorDateTime(new Date(item.endedAt), timezone) : 'Running'
    case 'durationMs':
      return typeof item.durationMs === 'number' ? `${item.durationMs}ms` : '—'
    case 'cost':
      return typeof item.cost === 'number' ? `$${item.cost.toFixed(4)}` : '—'
    case 'monitor':
      return item.monitorId || 'Removed monitor'
  }
}

const resolveQuickFilterValue = (item: any, field: ExecutionMonitorVisibleFieldId) => {
  switch (field) {
    case 'workflow':
      return item.workflowId
    case 'provider':
      return item.providerId
    case 'interval':
      return item.interval
    case 'assetType':
      return item.assetType
    case 'trigger':
      return item.trigger
    case 'monitor':
      return item.monitorId
    default:
      return null
  }
}

const resolveQuickFilterField = (
  field: ExecutionMonitorVisibleFieldId
): ExecutionMonitorQuickFilterField | null => {
  switch (field) {
    case 'workflow':
    case 'provider':
    case 'interval':
    case 'assetType':
    case 'trigger':
    case 'monitor':
      return field
    default:
      return null
  }
}

const reorderWithinColumn = (
  column: MonitorBoardColumn,
  activeId: string,
  overId?: string,
  direction: KanbanDropDirection = 'none'
) => {
  const nextIds = column.items.map((item) => item.logId).filter((itemId) => itemId !== activeId)

  if (!overId || direction === 'none') {
    return [...nextIds, activeId]
  }

  const overIndex = nextIds.indexOf(overId)
  if (overIndex === -1) {
    return [...nextIds, activeId]
  }

  const insertIndex = direction === 'bottom' ? overIndex + 1 : overIndex
  nextIds.splice(insertIndex, 0, activeId)
  return nextIds
}

const moveWithinColumn = (
  column: MonitorBoardColumn,
  activeId: string,
  direction: 'up' | 'down'
) => {
  const nextIds = column.items.map((item) => item.logId)
  const currentIndex = nextIds.indexOf(activeId)
  if (currentIndex === -1) return nextIds

  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (nextIndex < 0 || nextIndex >= nextIds.length) return nextIds

  const [movedId] = nextIds.splice(currentIndex, 1)
  if (!movedId) return nextIds
  nextIds.splice(nextIndex, 0, movedId)
  return nextIds
}

export function MonitorBoard({
  sections,
  selectedExecutionLogId,
  visibleFieldIds,
  timezone,
  canReorder,
  onSelectExecution,
  onToggleQuickFilter,
  isQuickFilterActive,
  onReorderColumnCards,
}: MonitorBoardProps) {
  const [dragState, setDragState] = useState<DragState>(null)
  const cardColumnById = useMemo(() => {
    const entries = sections.flatMap((section) =>
      section.columns.flatMap((column) =>
        column.items.map((item) => [item.logId, column.id] as const)
      )
    )
    return new Map(entries)
  }, [sections])

  const handleDragStart = useCallback(
    (event: KanbanDragEvent) => {
      const cardId = event.activeItem.id
      const columnId = cardColumnById.get(cardId)
      setDragState(canReorder && columnId ? { cardId, columnId } : null)
    },
    [canReorder, cardColumnById]
  )

  const handleDragEnd = useCallback(() => {
    setDragState(null)
  }, [])

  const handleDropAtColumn = (column: MonitorBoardColumn) => {
    if (!canReorder || !dragState || dragState.columnId !== column.id) {
      return
    }

    onReorderColumnCards(column.id, reorderWithinColumn(column, dragState.cardId))
    setDragState(null)
  }

  const handleDropAtItem = (
    column: MonitorBoardColumn,
    overId: string,
    direction: KanbanDropDirection
  ) => {
    if (!canReorder || !dragState || dragState.columnId !== column.id) {
      return
    }

    onReorderColumnCards(
      column.id,
      reorderWithinColumn(column, dragState.cardId, overId, direction)
    )
    setDragState(null)
  }

  return (
    <KanbanProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragEnd}
    >
      <MonitorKanbanShell>
        {sections.map((section) => (
          <MonitorKanbanSection
            key={section.id}
            title={section.label}
            description={`${section.columns.reduce((sum, column) => sum + column.totalCount, 0)} executions`}
            actions={
              !canReorder ? (
                <Badge variant='secondary' className='text-[10px]'>
                  Sorted
                </Badge>
              ) : null
            }
          >
            <MonitorKanbanBoard>
              {section.columns.map((column) => {
                const canDrop = canReorder && dragState?.columnId === column.id

                return (
                  <MonitorKanbanColumn
                    key={column.id}
                    columnId={column.id}
                    title={column.label}
                    count={column.totalCount}
                    canDrop={canDrop}
                    onDropOverColumn={() => handleDropAtColumn(column)}
                    itemIds={column.items.map((item) => item.logId)}
                    summary={`${column.totalCount} items`}
                    metaAction={
                      column.limit ? (
                        <Badge variant='outline' className='text-[10px]'>
                          Limit {column.limit}
                        </Badge>
                      ) : null
                    }
                    aggregates={column.aggregates}
                    formatAggregateValue={(field, value) =>
                      typeof value === 'number' ? value.toFixed(field === 'count' ? 0 : 2) : value
                    }
                  >
                    {column.items.length === 0 ? (
                      <MonitorKanbanEmptyCard />
                    ) : (
                      column.items.map((item) => (
                        <MonitorKanbanCard
                          key={item.logId}
                          data={{ id: item.logId, columnId: column.id }}
                          selected={selectedExecutionLogId === item.logId}
                          onDropOverCard={
                            canDrop && dragState?.cardId !== item.logId
                              ? (_, direction) => handleDropAtItem(column, item.logId, direction)
                              : undefined
                          }
                          onClick={() => onSelectExecution(item.logId)}
                          onKeyDown={(event) => {
                            if (!canReorder) return
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                            event.preventDefault()
                            event.stopPropagation()
                            onReorderColumnCards(
                              column.id,
                              moveWithinColumn(
                                column,
                                item.logId,
                                event.key === 'ArrowUp' ? 'up' : 'down'
                              )
                            )
                          }}
                          disabled={!canReorder}
                        >
                          <MonitorKanbanCardHeader
                            title={item.listingLabel}
                            subtitle={item.executionId || item.logId}
                          />

                          <div className='flex flex-wrap gap-1.5'>
                            {visibleFieldIds.map((fieldId) => {
                              const quickFilterField = resolveQuickFilterField(fieldId)
                              const quickFilterValue = resolveQuickFilterValue(item, fieldId)
                              const isActive = Boolean(
                                quickFilterField &&
                                  quickFilterValue &&
                                  isQuickFilterActive(quickFilterField, quickFilterValue)
                              )

                              return (
                                <MonitorKanbanFieldChip
                                  key={`${item.logId}:${fieldId}`}
                                  active={isActive}
                                  label={fieldId}
                                  value={formatVisibleField(item, fieldId, timezone)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    if (quickFilterField && quickFilterValue) {
                                      onToggleQuickFilter(quickFilterField, quickFilterValue)
                                    }
                                  }}
                                />
                              )
                            })}
                          </div>

                          {item.isOrphaned ? (
                            <Badge variant='destructive' className='text-[10px]'>
                              Source monitor unavailable
                            </Badge>
                          ) : null}
                          {item.isPartial ? (
                            <Badge variant='outline' className='text-[10px]'>
                              Snapshot incomplete
                            </Badge>
                          ) : null}
                        </MonitorKanbanCard>
                      ))
                    )}
                  </MonitorKanbanColumn>
                )
              })}
            </MonitorKanbanBoard>
          </MonitorKanbanSection>
        ))}
      </MonitorKanbanShell>
    </KanbanProvider>
  )
}
