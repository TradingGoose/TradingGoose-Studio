'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { formatTemplate } from '@/i18n/utils'
import { type KanbanDragEvent, type KanbanDropDirection, KanbanProvider } from '../board/kanban'
import {
  MonitorKanbanBoard,
  MonitorKanbanCard,
  MonitorKanbanCardHeader,
  MonitorKanbanColumn,
  MonitorKanbanEmptyCard,
  MonitorKanbanFieldChip,
  MonitorKanbanGroup,
  MonitorKanbanSection,
  MonitorKanbanShell,
} from '../board/monitor-kanban'
import { formatMonitorDateTime } from '../shared/monitor-time'
import type { ConfigMonitorVisibleField } from '../view/view-config'
import type {
  ConfigBoardBucket,
  ConfigBoardContext,
  ConfigBoardSection,
} from './config-board-state'
import type { ConfigMonitorCard } from './config-card-model'

type MonitorConfigBoardProps = {
  sections: ConfigBoardSection[]
  selectedMonitorId: string | null
  visibleFieldIds: ConfigMonitorVisibleField[]
  timezone: string
  canReorder: boolean
  onSelectCard: (card: ConfigMonitorCard) => void
  onCreateInContext: (context: ConfigBoardContext) => void
  onMoveCard: (monitorId: string, targetContext: ConfigBoardContext) => void
  onReorderBucketCards: (bucketId: string, nextMonitorIds: string[]) => void
}

type DragState = {
  cardId: string
  bucketId: string
} | null

const formatVisibleField = (
  card: ConfigMonitorCard,
  field: ConfigMonitorVisibleField,
  timezone: string,
  copy: ReturnType<typeof useMonitorCopy>['copy']
) => {
  switch (field) {
    case 'workflowTarget':
      return card.workflowTargetLabel
    case 'indicator':
      return card.indicatorName
    case 'listing':
      return card.listingLabel
    case 'provider':
      return card.providerLabel
    case 'interval':
      return card.interval
    case 'status':
      return card.status
    case 'createdAt':
      return formatMonitorDateTime(new Date(card.createdAt), timezone)
    case 'updatedAt':
      return formatMonitorDateTime(new Date(card.updatedAt), timezone)
    case 'lastExecutionAt':
      return card.lastExecutionAt
        ? formatMonitorDateTime(new Date(card.lastExecutionAt), timezone)
        : copy.config.noExecutions
    case 'lastOutcome':
      return card.lastOutcome ?? copy.config.noOutcome
  }
}

const reorderWithinBucket = (
  bucket: ConfigBoardBucket,
  activeId: string,
  overId?: string,
  direction: KanbanDropDirection = 'none'
) => {
  const nextIds = bucket.cards.map((card) => card.monitorId).filter((id) => id !== activeId)
  if (!overId || direction === 'none') return nextIds.concat(activeId)

  const overIndex = nextIds.indexOf(overId)
  if (overIndex === -1) return nextIds.concat(activeId)

  nextIds.splice(direction === 'bottom' ? overIndex + 1 : overIndex, 0, activeId)
  return nextIds
}

export function MonitorConfigBoard({
  sections,
  selectedMonitorId,
  visibleFieldIds,
  timezone,
  canReorder,
  onSelectCard,
  onCreateInContext,
  onMoveCard,
  onReorderBucketCards,
}: MonitorConfigBoardProps) {
  const { copy } = useMonitorCopy()
  const [dragState, setDragState] = useState<DragState>(null)
  const fieldLabels: Record<ConfigMonitorVisibleField, string> = {
    workflowTarget: copy.fields.workflowTarget,
    indicator: copy.fields.indicator,
    listing: copy.fields.listing,
    provider: copy.fields.provider,
    interval: copy.fields.interval,
    status: copy.fields.status,
    createdAt: copy.fields.createdAt,
    updatedAt: copy.fields.updatedAt,
    lastExecutionAt: copy.fields.lastExecution,
    lastOutcome: copy.fields.lastOutcome,
  }
  const bucketByCardId = useMemo(() => {
    const entries = sections.flatMap((section) =>
      section.groups.flatMap((group) =>
        group.statusLanes.flatMap((lane) =>
          lane.buckets.flatMap((bucket) =>
            bucket.cards.map((card) => [card.monitorId, bucket.id] as const)
          )
        )
      )
    )
    return new Map(entries)
  }, [sections])

  const handleDragStart = useCallback(
    (event: KanbanDragEvent) => {
      const cardId = event.activeItem.id
      const bucketId = bucketByCardId.get(cardId)
      setDragState(bucketId ? { cardId, bucketId } : null)
    },
    [bucketByCardId]
  )

  const clearDragState = useCallback(() => setDragState(null), [])

  const handleDropAtBucket = (bucket: ConfigBoardBucket) => {
    if (!dragState) return

    if (dragState.bucketId === bucket.id) {
      if (canReorder) {
        onReorderBucketCards(bucket.id, reorderWithinBucket(bucket, dragState.cardId))
      }
    } else {
      onMoveCard(dragState.cardId, bucket.context)
    }

    setDragState(null)
  }

  const handleDropAtCard = (
    bucket: ConfigBoardBucket,
    overId: string,
    direction: KanbanDropDirection
  ) => {
    if (!dragState) return

    if (dragState.bucketId === bucket.id) {
      if (canReorder) {
        onReorderBucketCards(
          bucket.id,
          reorderWithinBucket(bucket, dragState.cardId, overId, direction)
        )
      }
    } else {
      onMoveCard(dragState.cardId, bucket.context)
    }

    setDragState(null)
  }

  return (
    <KanbanProvider
      onDragStart={handleDragStart}
      onDragEnd={clearDragState}
      onDragCancel={clearDragState}
    >
      <MonitorKanbanShell>
        {sections.map((section) => (
          <MonitorKanbanSection key={section.id}>
            {section.groups.map((group) => (
              <MonitorKanbanGroup
                key={`${section.id}:${group.id}`}
                title={section.groups.length > 1 ? group.label : null}
              >
                <MonitorKanbanBoard>
                  {group.statusLanes.flatMap((lane) =>
                    lane.buckets.map((bucket) => {
                      const canDrop = Boolean(dragState)
                      const title =
                        bucket.label === 'All' ? lane.label : `${lane.label} - ${bucket.label}`

                      return (
                        <MonitorKanbanColumn
                          key={bucket.id}
                          columnId={bucket.id}
                          title={title}
                          count={bucket.cards.length}
                          canDrop={canDrop}
                          onDropOverColumn={() => handleDropAtBucket(bucket)}
                          itemIds={bucket.cards.map((card) => card.monitorId)}
                          headerAction={
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              className='h-7 w-7'
                              aria-label={formatTemplate(copy.config.addMonitorIn, { title })}
                              onClick={() => onCreateInContext(bucket.context)}
                            >
                              <Plus className='h-4 w-4' />
                            </Button>
                          }
                          aggregates={bucket.aggregates}
                        >
                          {bucket.cards.length === 0 ? (
                            <MonitorKanbanEmptyCard />
                          ) : (
                            bucket.cards.map((card) => (
                              <MonitorKanbanCard
                                key={card.monitorId}
                                data={{ id: card.monitorId, columnId: bucket.id }}
                                selected={selectedMonitorId === card.monitorId}
                                onDropOverCard={
                                  dragState !== null && dragState.cardId !== card.monitorId
                                    ? (_, direction) =>
                                        handleDropAtCard(bucket, card.monitorId, direction)
                                    : undefined
                                }
                                onClick={() => onSelectCard(card)}
                              >
                                <MonitorKanbanCardHeader
                                  title={card.indicatorName}
                                  subtitle={card.workflowTargetLabel}
                                />

                                <div className='flex flex-wrap gap-1.5'>
                                  {visibleFieldIds.map((fieldId) => (
                                    <MonitorKanbanFieldChip
                                      key={`${card.monitorId}:${fieldId}`}
                                      label={fieldLabels[fieldId]}
                                      value={formatVisibleField(card, fieldId, timezone, copy)}
                                    />
                                  ))}
                                </div>

                                <Badge
                                  variant={card.isActive ? 'secondary' : 'outline'}
                                  className='text-[10px]'
                                >
                                  {card.isActive ? copy.fields.active : copy.fields.paused}
                                </Badge>
                              </MonitorKanbanCard>
                            ))
                          )}
                        </MonitorKanbanColumn>
                      )
                    })
                  )}
                </MonitorKanbanBoard>
              </MonitorKanbanGroup>
            ))}
          </MonitorKanbanSection>
        ))}
      </MonitorKanbanShell>
    </KanbanProvider>
  )
}
