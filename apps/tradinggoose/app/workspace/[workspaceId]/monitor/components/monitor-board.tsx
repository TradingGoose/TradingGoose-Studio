'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { formatDistanceToNow } from 'date-fns'
import { Activity, Pause, Pen, Play, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { IndicatorMonitorRecord } from './types'
import {
  type MonitorBoardColumn,
  type MonitorEntity,
  getMonitorStatusLabel,
} from './board-state'
import {
  KanbanBoard,
  KanbanBoardProvider,
  KanbanCard,
  KanbanColumn,
  KanbanColumnList,
  KanbanColumnListItem,
  KanbanColumns,
  type KanbanDropDirection,
  useDndEvents,
} from './kanban'
import type { MonitorGroupBy, MonitorVisibleFields } from './view-config'

type MonitorBoardProps = {
  columns: MonitorBoardColumn[]
  groupBy: MonitorGroupBy
  visibleFields: MonitorVisibleFields
  selectedMonitorId: string | null
  togglingMonitorId: string | null
  deletingMonitorId: string | null
  onSelectMonitor: (monitorId: string) => void
  onEditMonitor: (monitor: IndicatorMonitorRecord) => void
  onToggleMonitorState: (monitor: IndicatorMonitorRecord) => void
  onDeleteMonitor: (monitorId: string) => void
  onMoveMonitorStatus: (monitor: IndicatorMonitorRecord, nextStatus: 'running' | 'paused') => void
  onUpdateStatusBoardCardOrder: (nextVisibleOrder: string[]) => void
}

const STATUS_DROP_COLUMNS = new Set(['running', 'paused'])

const statusBadgeClassName = (status: MonitorEntity['primaryStatus']) => {
  if (status === 'running') return 'bg-emerald-500/15 text-emerald-600'
  if (status === 'paused') return 'bg-slate-500/15 text-slate-500'
  if (status === 'needs_deploy') return 'bg-amber-500/15 text-amber-600'
  return 'bg-red-500/15 text-red-600'
}

const cloneColumns = (columns: MonitorBoardColumn[]) =>
  columns.map((column) => ({
    ...column,
    items: [...column.items],
  }))

const getColumnsSignature = (columns: MonitorBoardColumn[]) =>
  columns
    .map((column) => `${column.id}:${column.items.map((item) => item.id).join(',')}`)
    .join('|')

const flattenVisibleCardOrder = (columns: MonitorBoardColumn[]) =>
  columns.flatMap((column) => column.items.map((item) => item.id))

const readTransferredEntityId = (value: string) => {
  if (!value) {
    return ''
  }

  try {
    const parsed = JSON.parse(value) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id.trim() : ''
  } catch {
    return ''
  }
}

const getOverId = (columns: MonitorBoardColumn[], columnIndex: number, cardIndex: number) => {
  const column = columns[columnIndex]

  if (!column) {
    return undefined
  }

  if (cardIndex < column.items.length - 1) {
    return column.items[cardIndex + 1]?.id
  }

  return column.id
}

const findEntityPosition = (columns: MonitorBoardColumn[], entityId: string) => {
  for (const [columnIndex, column] of columns.entries()) {
    const itemIndex = column.items.findIndex((item) => item.id === entityId)

    if (itemIndex !== -1) {
      return {
        columnId: column.id,
        columnIndex,
        itemIndex,
      }
    }
  }

  return null
}

const moveEntityToPosition = (
  columns: MonitorBoardColumn[],
  entityId: string,
  targetColumnId: string,
  targetIndex: number
) => {
  const source = findEntityPosition(columns, entityId)

  if (!source) {
    return null
  }

  const sourceColumn = columns[source.columnIndex]
  const entity = sourceColumn?.items[source.itemIndex]
  const targetColumnIndex = columns.findIndex((column) => column.id === targetColumnId)
  const targetColumn = targetColumnIndex >= 0 ? columns[targetColumnIndex] : null

  if (!entity || !targetColumn) {
    return null
  }

  const nextColumns = cloneColumns(columns)
  const nextSourceItems = nextColumns[source.columnIndex]?.items
  const nextTargetItems = nextColumns[targetColumnIndex]?.items

  if (!nextSourceItems || !nextTargetItems) {
    return null
  }

  nextSourceItems.splice(source.itemIndex, 1)

  let nextInsertIndex = Math.max(0, Math.min(targetIndex, nextTargetItems.length))

  if (source.columnIndex === targetColumnIndex && source.itemIndex < nextInsertIndex) {
    nextInsertIndex -= 1
  }

  if (source.columnIndex === targetColumnIndex && source.itemIndex === nextInsertIndex) {
    return columns
  }

  nextTargetItems.splice(nextInsertIndex, 0, entity)

  return nextColumns
}

const canMoveBetweenColumns = (sourceColumnId: string, targetColumnId: string) =>
  sourceColumnId === targetColumnId ||
  (STATUS_DROP_COLUMNS.has(sourceColumnId) && STATUS_DROP_COLUMNS.has(targetColumnId))

const buildBoardMovePreview = (
  columns: MonitorBoardColumn[],
  entityId: string,
  targetColumnId: string,
  targetIndex: number
) => {
  const source = findEntityPosition(columns, entityId)

  if (!source) {
    return null
  }

  const entity = columns[source.columnIndex]?.items[source.itemIndex]

  if (!entity || !canMoveBetweenColumns(source.columnId, targetColumnId)) {
    return null
  }

  const nextColumns = moveEntityToPosition(columns, entityId, targetColumnId, targetIndex)

  if (!nextColumns || nextColumns === columns) {
    return null
  }

  return {
    entity,
    nextColumns,
    nextStatus:
      source.columnId === targetColumnId ? null : (targetColumnId as 'running' | 'paused'),
  }
}

function MonitorCardContent({
  entity,
  visibleFields,
  togglingMonitorId,
  deletingMonitorId,
  onEditMonitor,
  onToggleMonitorState,
  onDeleteMonitor,
}: {
  entity: MonitorEntity
  visibleFields: MonitorVisibleFields
  togglingMonitorId: string | null
  deletingMonitorId: string | null
  onEditMonitor: (monitor: IndicatorMonitorRecord) => void
  onToggleMonitorState: (monitor: IndicatorMonitorRecord) => void
  onDeleteMonitor: (monitorId: string) => void
}) {
  const ProviderIcon = entity.providerIcon
  const isToggling = togglingMonitorId === entity.id
  const isDeleting = deletingMonitorId === entity.id

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <MarketListingRow
            listing={entity.listingOption}
            showAssetClass={false}
            compact={false}
            className='rounded-md border border-border bg-card/40 pr-2'
          />
        </div>
        <Badge
          className={cn(
            'shrink-0 border-0 text-[10px]',
            statusBadgeClassName(entity.primaryStatus)
          )}
        >
          {getMonitorStatusLabel(entity.primaryStatus)}
        </Badge>
      </div>

      <div className='flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2'>
        <span
          className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md'
          style={{ backgroundColor: `${entity.indicatorColor}20`, color: entity.indicatorColor }}
        >
          <Activity className='h-4 w-4' />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='truncate font-medium text-sm'>{entity.indicatorName}</div>
          {visibleFields.interval ? (
            <div className='text-muted-foreground text-xs'>
              {entity.monitor.providerConfig.monitor.interval}
            </div>
          ) : null}
        </div>
      </div>

      <div className='flex flex-wrap gap-2'>
        {visibleFields.workflow ? (
          <InfoBadge icon={<WorkflowIcon className='h-3 w-3' />} label={entity.workflowName} />
        ) : null}
        {visibleFields.provider ? (
          <InfoBadge
            icon={ProviderIcon ? <ProviderIcon className='h-3 w-3' /> : undefined}
            label={entity.providerName}
          />
        ) : null}
        {visibleFields.interval ? (
          <InfoBadge label={entity.monitor.providerConfig.monitor.interval} />
        ) : null}
        {visibleFields.assetType ? <InfoBadge label={entity.assetTypeLabel} /> : null}
        {visibleFields.trigger ? <InfoBadge label={entity.triggerName} /> : null}
        {visibleFields.authHealth ? (
          <HealthBadge
            ok={entity.authConfigured}
            label={entity.authConfigured ? 'Auth OK' : 'Auth Missing'}
          />
        ) : null}
        {visibleFields.deployHealth ? (
          <HealthBadge
            ok={!entity.needsDeploy}
            label={entity.needsDeploy ? 'Needs Deploy' : 'Deployed'}
          />
        ) : null}
        {visibleFields.updatedAt ? (
          <InfoBadge
            label={`Updated ${formatDistanceToNow(entity.updatedAtDate, { addSuffix: true })}`}
          />
        ) : null}
        {entity.secondaryStatuses.map((status) => (
          <Badge key={status} className={cn('border-0 text-[10px]', statusBadgeClassName(status))}>
            {getMonitorStatusLabel(status)}
          </Badge>
        ))}
      </div>

      <div className='flex items-center justify-between gap-2 border-t pt-2'>
        <div className='text-[11px] text-muted-foreground'>
          {entity.monitor.isActive ? 'Active monitor' : 'Paused monitor'}
        </div>
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={(event) => {
              event.stopPropagation()
              onEditMonitor(entity.monitor)
            }}
          >
            <Pen className='h-3.5 w-3.5' />
            <span className='sr-only'>Edit monitor</span>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            disabled={
              entity.monitor.isActive
                ? !entity.canPause || isToggling
                : !entity.canResume || isToggling
            }
            onClick={(event) => {
              event.stopPropagation()
              onToggleMonitorState(entity.monitor)
            }}
          >
            {entity.monitor.isActive ? (
              <Pause className='h-3.5 w-3.5' />
            ) : (
              <Play className='h-3.5 w-3.5' />
            )}
            <span className='sr-only'>
              {entity.monitor.isActive ? 'Pause monitor' : 'Resume monitor'}
            </span>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8 text-destructive hover:text-destructive'
            disabled={isDeleting}
            onClick={(event) => {
              event.stopPropagation()
              onDeleteMonitor(entity.monitor.monitorId)
            }}
          >
            <Trash2 className='h-3.5 w-3.5' />
            <span className='sr-only'>Delete monitor</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

function InfoBadge({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <Badge variant='outline' className='gap-1 text-[10px]'>
      {icon}
      <span className='truncate'>{label}</span>
    </Badge>
  )
}

function HealthBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      className={cn(
        'border-0 text-[10px]',
        ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'
      )}
    >
      {label}
    </Badge>
  )
}

function MonitorBoardContent({
  columns,
  groupBy,
  visibleFields,
  selectedMonitorId,
  togglingMonitorId,
  deletingMonitorId,
  onSelectMonitor,
  onEditMonitor,
  onToggleMonitorState,
  onDeleteMonitor,
  onMoveMonitorStatus,
  onUpdateStatusBoardCardOrder,
}: MonitorBoardProps) {
  const isStatusBoard = groupBy === 'status'
  const columnsSignature = useMemo(() => getColumnsSignature(columns), [columns])
  const [displayColumns, setDisplayColumns] = useState(() => cloneColumns(columns))
  const [activeCardId, setActiveCardId] = useState('')
  const dragStartColumnsReference = useRef<MonitorBoardColumn[] | null>(null)
  const originalCardPositionReference = useRef<{ columnId: string; itemIndex: number } | null>(null)
  const { onDragCancel, onDragEnd, onDragOver, onDragStart } = useDndEvents()

  useEffect(() => {
    if (activeCardId === '') {
      setDisplayColumns(cloneColumns(columns))
    }
  }, [activeCardId, columnsSignature, columns])

  const entityById = useMemo(
    () =>
      new Map(
        displayColumns.flatMap((column) => column.items).map((entity) => [entity.id, entity] as const)
      ),
    [displayColumns]
  )

  const commitBoardChange = (
    nextColumns: MonitorBoardColumn[],
    entity: MonitorEntity,
    nextStatus: 'running' | 'paused' | null
  ) => {
    flushSync(() => {
      setDisplayColumns(nextColumns)
    })

    onUpdateStatusBoardCardOrder(flattenVisibleCardOrder(nextColumns))

    if (nextStatus && entity.primaryStatus !== nextStatus) {
      onMoveMonitorStatus(entity.monitor, nextStatus)
    }
  }

  const commitCardMove = (entityId: string, targetColumnId: string, targetIndex: number) => {
    if (!isStatusBoard) {
      return null
    }

    const preview = buildBoardMovePreview(displayColumns, entityId, targetColumnId, targetIndex)

    if (!preview) {
      onDragCancel(entityId)
      return null
    }

    commitBoardChange(preview.nextColumns, preview.entity, preview.nextStatus)

    return preview.nextColumns
  }

  const previewCardMove = (entityId: string, targetColumnId: string, targetIndex: number) => {
    if (!isStatusBoard) {
      return null
    }

    const preview = buildBoardMovePreview(displayColumns, entityId, targetColumnId, targetIndex)

    if (!preview) {
      return null
    }

    setDisplayColumns(preview.nextColumns)

    return preview.nextColumns
  }

  const moveActiveCard = (
    entityId: string,
    direction: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  ) => {
    const position = findEntityPosition(displayColumns, entityId)

    if (!position) {
      return
    }

    let nextColumnIndex = position.columnIndex
    let nextItemIndex = position.itemIndex

    switch (direction) {
      case 'ArrowUp':
        nextItemIndex = Math.max(position.itemIndex - 1, 0)
        break
      case 'ArrowDown':
        nextItemIndex = Math.min(
          position.itemIndex + 1,
          Math.max(displayColumns[position.columnIndex]?.items.length ?? 1, 1) - 1
        )
        break
      case 'ArrowLeft':
        nextColumnIndex = Math.max(position.columnIndex - 1, 0)
        nextItemIndex = Math.min(
          position.itemIndex,
          displayColumns[nextColumnIndex]?.items.length ?? 0
        )
        break
      case 'ArrowRight':
        nextColumnIndex = Math.min(position.columnIndex + 1, displayColumns.length - 1)
        nextItemIndex = Math.min(
          position.itemIndex,
          displayColumns[nextColumnIndex]?.items.length ?? 0
        )
        break
    }

    const nextColumn = displayColumns[nextColumnIndex]

    if (!nextColumn) {
      return
    }

    const nextColumns = previewCardMove(entityId, nextColumn.id, nextItemIndex)

    if (!nextColumns) {
      return
    }

    const updatedPosition = findEntityPosition(nextColumns, entityId)

    if (!updatedPosition) {
      return
    }

    onDragOver(entityId, getOverId(nextColumns, updatedPosition.columnIndex, updatedPosition.itemIndex))
  }

  const commitKeyboardDrop = (entityId: string) => {
    const position = findEntityPosition(displayColumns, entityId)
    const originalPosition = originalCardPositionReference.current
    const entity = entityById.get(entityId)

    if (
      position &&
      originalPosition &&
      entity &&
      (position.columnId !== originalPosition.columnId || position.itemIndex !== originalPosition.itemIndex)
    ) {
      onUpdateStatusBoardCardOrder(flattenVisibleCardOrder(displayColumns))

      if (position.columnId !== originalPosition.columnId) {
        onMoveMonitorStatus(entity.monitor, position.columnId as 'running' | 'paused')
      }
    }

    onDragEnd(entityId, position ? getOverId(displayColumns, position.columnIndex, position.itemIndex) : undefined)
    originalCardPositionReference.current = null
    dragStartColumnsReference.current = null
    setActiveCardId('')
  }

  const cancelKeyboardDrop = (entityId: string) => {
    const dragStartColumns = dragStartColumnsReference.current

    if (dragStartColumns) {
      setDisplayColumns(cloneColumns(dragStartColumns))
    }

    onDragCancel(entityId)
    originalCardPositionReference.current = null
    dragStartColumnsReference.current = null
    setActiveCardId('')
  }

  const canDropIntoColumn = (targetColumnId: string) => {
    if (!isStatusBoard) {
      return false
    }

    if (!activeCardId) {
      return STATUS_DROP_COLUMNS.has(targetColumnId)
    }

    const source = findEntityPosition(displayColumns, activeCardId)

    if (!source) {
      return STATUS_DROP_COLUMNS.has(targetColumnId)
    }

    return canMoveBetweenColumns(source.columnId, targetColumnId)
  }

  const canDropOnCard = (targetColumnId: string) => {
    if (!isStatusBoard) {
      return false
    }

    if (!activeCardId) {
      return true
    }

    const source = findEntityPosition(displayColumns, activeCardId)

    if (!source) {
      return true
    }

    return canMoveBetweenColumns(source.columnId, targetColumnId)
  }

  const handleCardKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    entityId: string
  ) => {
    if (!isStatusBoard) {
      return
    }

    const { key } = event

    if (activeCardId === '' && key === ' ') {
      event.preventDefault()
      setActiveCardId(entityId)
      onDragStart(entityId)
      dragStartColumnsReference.current = cloneColumns(displayColumns)

      const position = findEntityPosition(displayColumns, entityId)
      originalCardPositionReference.current = position
        ? { columnId: position.columnId, itemIndex: position.itemIndex }
        : null
      return
    }

    if (activeCardId !== entityId) {
      return
    }

    if (key === ' ' || key === 'Enter') {
      event.preventDefault()
      commitKeyboardDrop(entityId)
      return
    }

    if (key === 'Escape') {
      event.preventDefault()
      cancelKeyboardDrop(entityId)
      return
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault()
      moveActiveCard(entityId, key)
    }
  }

  return (
    <KanbanBoard>
      <KanbanColumns>
        {displayColumns.length === 0 ? (
          <div className='flex min-h-full min-w-[320px] flex-1 items-center justify-center rounded-xl border border-dashed bg-card/40 px-6 text-center text-muted-foreground text-sm'>
            No monitors are available for the current Kanban view.
          </div>
        ) : null}

        {displayColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            columnId={column.id}
            title={column.label}
            count={column.items.length}
            canDrop={canDropIntoColumn(column.id)}
            onDropOverColumn={(dataTransferData) => {
              const activeId = activeCardId || readTransferredEntityId(dataTransferData)

              if (!activeId) {
                return
              }

              commitCardMove(activeId, column.id, column.items.length)
            }}
          >
            <KanbanColumnList>
              {column.items.length === 0 ? (
                <li className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
                  No monitors in this lane.
                </li>
              ) : (
                column.items.map((entity) => (
                  <KanbanColumnListItem
                    key={entity.id}
                    canDrop={canDropOnCard(column.id)}
                    cardId={entity.id}
                    onDropOverListItem={(dataTransferData, dropDirection: KanbanDropDirection) => {
                      const targetCardIndex = column.items.findIndex((item) => item.id === entity.id)
                      const targetIndex =
                        dropDirection === 'top' ? targetCardIndex : targetCardIndex + 1

                      const activeId = activeCardId || readTransferredEntityId(dataTransferData)

                      if (!activeId) {
                        return
                      }

                      commitCardMove(activeId, column.id, targetIndex)
                    }}
                  >
                    <KanbanCard
                      data={{ id: entity.id }}
                      disabled={!isStatusBoard}
                      isActive={activeCardId === entity.id}
                      selected={selectedMonitorId === entity.id}
                      onClick={() => onSelectMonitor(entity.id)}
                      onDragStart={() => {
                        if (isStatusBoard) {
                          setActiveCardId(entity.id)
                        }
                      }}
                      onDragEnd={() => {
                        setActiveCardId('')
                        originalCardPositionReference.current = null
                      }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault()
                        }

                        handleCardKeyDown(event, entity.id)
                      }}
                    >
                      <MonitorCardContent
                        entity={entity}
                        visibleFields={visibleFields}
                        togglingMonitorId={togglingMonitorId}
                        deletingMonitorId={deletingMonitorId}
                        onEditMonitor={onEditMonitor}
                        onToggleMonitorState={onToggleMonitorState}
                        onDeleteMonitor={onDeleteMonitor}
                      />
                    </KanbanCard>
                  </KanbanColumnListItem>
                ))
              )}
            </KanbanColumnList>
          </KanbanColumn>
        ))}
      </KanbanColumns>
    </KanbanBoard>
  )
}

export function MonitorBoard(props: MonitorBoardProps) {
  return (
    <KanbanBoardProvider>
      <MonitorBoardContent {...props} />
    </KanbanBoardProvider>
  )
}
