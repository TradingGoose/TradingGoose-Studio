'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MonitorBoardColumn, MonitorBoardSection } from './board-state'
import {
  KanbanBoard,
  KanbanBoardProvider,
  KanbanCard,
  KanbanColumn,
  KanbanColumnList,
  KanbanColumnListItem,
  type KanbanDropDirection,
} from './kanban'
import { formatMonitorDateTime } from '../shared/monitor-time'
import type { MonitorQuickFilterField, MonitorVisibleFieldId } from '../view/view-config'

type MonitorBoardProps = {
  sections: MonitorBoardSection[]
  selectedExecutionLogId: string | null
  visibleFieldIds: MonitorVisibleFieldId[]
  timezone: string
  canReorder: boolean
  onSelectExecution: (logId: string) => void
  onToggleQuickFilter: (field: MonitorQuickFilterField, value: string) => void
  isQuickFilterActive: (field: MonitorQuickFilterField, value: string) => boolean
  onReorderColumnCards: (columnId: string, nextExecutionIds: string[]) => void
}

type DragState = {
  cardId: string
  columnId: string
} | null

const formatVisibleField = (item: any, field: MonitorVisibleFieldId, timezone: string) => {
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

const resolveQuickFilterValue = (item: any, field: MonitorVisibleFieldId) => {
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

const resolveQuickFilterField = (field: MonitorVisibleFieldId): MonitorQuickFilterField | null => {
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

const ColumnAggregates = ({ aggregates }: { aggregates: MonitorBoardColumn['aggregates'] }) => (
  <div className='flex flex-wrap gap-2 border-b px-3 py-2 text-[11px] text-muted-foreground'>
    {Object.entries(aggregates).map(([field, value]) => (
      <span key={field}>
        {field}: {typeof value === 'number' ? value.toFixed(field === 'count' ? 0 : 2) : value}
      </span>
    ))}
  </div>
)

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
    <KanbanBoardProvider>
      <div className='flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card/40'>
        <div className='flex min-h-0 w-full max-w-full min-w-0 flex-1 flex-col gap-4 overflow-auto p-4'>
          {sections.map((section) => (
            <section
              key={section.id}
              className='flex min-h-0 w-full max-w-full min-w-0 flex-1 flex-col gap-3'
            >
              <div className='flex items-center justify-between'>
                <div>
                  <h2 className='font-medium text-sm'>{section.label}</h2>
                  <p className='text-muted-foreground text-xs'>
                    {section.columns.reduce((sum, column) => sum + column.totalCount, 0)} executions
                  </p>
                </div>
                {!canReorder ? (
                  <Badge variant='secondary' className='text-[10px]'>
                    Sorted
                  </Badge>
                ) : null}
              </div>

              <KanbanBoard className='flex-1 pb-0'>
                {section.columns.map((column) => {
                  const canDrop = canReorder && dragState?.columnId === column.id

                  return (
                    <KanbanColumn
                      key={column.id}
                      columnId={column.id}
                      title={column.label}
                      count={column.totalCount}
                      canDrop={canDrop}
                      onDropOverColumn={() => handleDropAtColumn(column)}
                    >
                      <div className='flex items-center justify-between border-b px-3 py-2'>
                        <div className='text-muted-foreground text-xs'>
                          {column.totalCount} items
                        </div>
                        {column.limit ? (
                          <Badge variant='outline' className='text-[10px]'>
                            Limit {column.limit}
                          </Badge>
                        ) : null}
                      </div>
                      <ColumnAggregates aggregates={column.aggregates} />

                      <KanbanColumnList className='space-y-2'>
                        {column.items.length === 0 ? (
                          <li className='h-32 rounded-lg bg-muted/20' aria-hidden='true' />
                        ) : (
                          column.items.map((item) => (
                            <KanbanColumnListItem
                              key={item.logId}
                              cardId={item.logId}
                              canDrop={canDrop && dragState?.cardId !== item.logId}
                              onDropOverListItem={(_, direction) =>
                                handleDropAtItem(column, item.logId, direction)
                              }
                            >
                              <KanbanCard
                                data={{ id: item.logId }}
                                selected={selectedExecutionLogId === item.logId}
                                onClick={() => onSelectExecution(item.logId)}
                                onDragStart={() =>
                                  setDragState(
                                    canReorder
                                      ? {
                                          cardId: item.logId,
                                          columnId: column.id,
                                        }
                                      : null
                                  )
                                }
                                onDragEnd={() => setDragState(null)}
                                disabled={!canReorder}
                                className={cn(
                                  'space-y-3 px-3 py-3 text-left transition hover:border-primary/50',
                                  selectedExecutionLogId === item.logId && 'border-primary'
                                )}
                              >
                                <div className='space-y-1'>
                                  <div className='font-medium text-sm'>{item.listingLabel}</div>
                                  <div className='text-muted-foreground text-xs'>
                                    {item.executionId || item.logId}
                                  </div>
                                </div>

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
                                      <Button
                                        key={`${item.logId}:${fieldId}`}
                                        type='button'
                                        variant={isActive ? 'secondary' : 'outline'}
                                        size='sm'
                                        aria-pressed={isActive}
                                        className={cn(
                                          'h-6 rounded-sm px-2 text-[11px]',
                                          isActive &&
                                            'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15'
                                        )}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          if (quickFilterField && quickFilterValue) {
                                            onToggleQuickFilter(quickFilterField, quickFilterValue)
                                          }
                                        }}
                                      >
                                        <span className='text-muted-foreground'>{fieldId}</span>
                                        <span>{formatVisibleField(item, fieldId, timezone)}</span>
                                      </Button>
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
                              </KanbanCard>
                            </KanbanColumnListItem>
                          ))
                        )}
                      </KanbanColumnList>
                    </KanbanColumn>
                  )
                })}
              </KanbanBoard>
            </section>
          ))}
        </div>
      </div>
    </KanbanBoardProvider>
  )
}
