'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  getMonitorAssetTypeLabel,
  getMonitorTriggerLabel,
  useMonitorCopy,
} from '@/app/workspace/[workspaceId]/monitor/copy'
import { formatDurationMs, formatUsd } from '@/i18n/formatters'
import { formatTemplate } from '@/i18n/client-messages'
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

const formatVisibleField = (
  item: any,
  field: ExecutionMonitorVisibleFieldId,
  timezone: string,
  locale: string,
  copy: ReturnType<typeof useMonitorCopy>['copy']
) => {
  switch (field) {
    case 'workflow':
      return item.workflowName
    case 'provider':
      return item.providerId || copy.execution.unknown
    case 'interval':
      return item.interval || copy.execution.unknown
    case 'assetType':
      return getMonitorAssetTypeLabel(copy, item.assetType)
    case 'trigger':
      return item.trigger ? getMonitorTriggerLabel(copy, item.trigger) : copy.execution.unknown
    case 'startedAt':
      return formatMonitorDateTime(new Date(item.startedAt), timezone)
    case 'endedAt':
      return item.endedAt
        ? formatMonitorDateTime(new Date(item.endedAt), timezone)
        : copy.execution.running
    case 'durationMs':
      return typeof item.durationMs === 'number' ? formatDurationMs(locale, item.durationMs) : '—'
    case 'cost':
      return typeof item.cost === 'number'
        ? formatUsd(locale, item.cost, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })
        : '—'
    case 'monitor':
      return item.monitorId || copy.execution.removedMonitor
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
  const { copy, locale } = useMonitorCopy()
  const [dragState, setDragState] = useState<DragState>(null)
  const fieldLabels: Partial<Record<ExecutionMonitorVisibleFieldId, string>> = {
    workflow: copy.fields.workflow,
    provider: copy.fields.provider,
    interval: copy.fields.interval,
    assetType: copy.fields.assetType,
    trigger: copy.fields.trigger,
    startedAt: copy.fields.startedAt,
    endedAt: copy.fields.endedAt,
    durationMs: copy.fields.duration,
    cost: copy.fields.cost,
    monitor: copy.fields.monitor,
  }
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
            description={formatTemplate(copy.shared.executionsCount, {
              count: section.columns.reduce((sum, column) => sum + column.totalCount, 0),
            })}
            actions={
              !canReorder ? (
                <Badge variant='secondary' className='text-[10px]'>
                  {copy.execution.sorted}
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
                    summary={formatTemplate(copy.shared.itemsCount, { count: column.totalCount })}
                    metaAction={
                      column.limit ? (
                        <Badge variant='outline' className='text-[10px]'>
                          {formatTemplate(copy.execution.limitLabel, { count: column.limit })}
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
                                  label={fieldLabels[fieldId] ?? fieldId}
                                  value={formatVisibleField(item, fieldId, timezone, locale, copy)}
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
                              {copy.execution.sourceMonitorUnavailable}
                            </Badge>
                          ) : null}
                          {item.isPartial ? (
                            <Badge variant='outline' className='text-[10px]'>
                              {copy.execution.snapshotIncomplete}
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
