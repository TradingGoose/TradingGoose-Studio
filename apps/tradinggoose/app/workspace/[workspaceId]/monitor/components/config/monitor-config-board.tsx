'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  type KanbanDragEvent,
  type KanbanDropDirection,
  KanbanProvider,
} from '../board/kanban'
import { formatMonitorDateTime } from '../shared/monitor-time'
import {
  MonitorAggregateBadges,
  MonitorBoardShell,
  MonitorSectionHeader,
} from '../shared/monitor-ui'
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
  timezone: string
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
        : 'No executions'
    case 'lastOutcome':
      return card.lastOutcome ?? 'No outcome'
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
  const [dragState, setDragState] = useState<DragState>(null)
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
      <MonitorBoardShell>
        {sections.map((section) => (
          <section key={section.id} className='flex min-h-0 flex-col gap-3'>
            <MonitorSectionHeader
              title={section.label}
              description={`${section.cards.length} monitor configs`}
            >
              <MonitorAggregateBadges
                entries={section.aggregates}
                variant='secondary'
                badgeClassName='text-[10px]'
              />
            </MonitorSectionHeader>

            {section.groups.map((group) => (
              <div key={`${section.id}:${group.id}`} className='space-y-2'>
                <div className='flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2'>
                  <div>
                    <div className='font-medium text-xs'>{group.label}</div>
                    <div className='text-[11px] text-muted-foreground'>
                      {group.cards.length} monitors
                    </div>
                  </div>
                  <MonitorAggregateBadges entries={group.aggregates} />
                </div>

                <KanbanBoard className='pb-0'>
                  {group.statusLanes.flatMap((lane) =>
                    lane.buckets.map((bucket) => {
                      const canDrop = Boolean(dragState)
                      const title =
                        bucket.label === 'All' ? lane.label : `${lane.label} - ${bucket.label}`

                      return (
                        <KanbanCards
                          key={bucket.id}
                          columnId={bucket.id}
                          title={title}
                          count={bucket.cards.length}
                          canDrop={canDrop}
                          onDropOverColumn={() => handleDropAtBucket(bucket)}
                          itemIds={bucket.cards.map((card) => card.monitorId)}
                          listClassName='space-y-2'
                          beforeCards={
                            <>
                              <div className='flex items-center justify-between border-b px-3 py-2'>
                                <div className='text-muted-foreground text-xs'>
                                  {bucket.cards.length} monitors
                                </div>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon'
                                  className='h-7 w-7'
                                  aria-label={`Add monitor in ${title}`}
                                  onClick={() => onCreateInContext(bucket.context)}
                                >
                                  <Plus className='h-4 w-4' />
                                </Button>
                              </div>
                              <MonitorAggregateBadges
                                entries={bucket.aggregates}
                                className='border-b px-3 py-2'
                              />
                            </>
                          }
                        >
                          {bucket.cards.length === 0 ? (
                            <li className='h-24 rounded-lg bg-muted/20' aria-hidden='true' />
                          ) : (
                            bucket.cards.map((card) => (
                              <KanbanCard
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
                                className={cn(
                                  'space-y-3 px-3 py-3 text-left transition hover:border-primary/50',
                                  selectedMonitorId === card.monitorId && 'border-primary'
                                )}
                              >
                                <div className='space-y-1'>
                                  <div className='font-medium text-sm'>{card.indicatorName}</div>
                                  <div className='text-muted-foreground text-xs'>
                                    {card.workflowTargetLabel}
                                  </div>
                                </div>

                                <div className='flex flex-wrap gap-1.5'>
                                  {visibleFieldIds.map((fieldId) => (
                                    <Badge
                                      key={`${card.monitorId}:${fieldId}`}
                                      variant='outline'
                                      className='gap-1 rounded-sm px-2 py-1 font-normal text-[11px]'
                                    >
                                      <span className='text-muted-foreground'>{fieldId}</span>
                                      <span>{formatVisibleField(card, fieldId, timezone)}</span>
                                    </Badge>
                                  ))}
                                </div>

                                <Badge
                                  variant={card.isActive ? 'secondary' : 'outline'}
                                  className='text-[10px]'
                                >
                                  {card.isActive ? 'Active' : 'Paused'}
                                </Badge>
                              </KanbanCard>
                            ))
                          )}
                        </KanbanCards>
                      )
                    })
                  )}
                </KanbanBoard>
              </div>
            ))}
          </section>
        ))}
      </MonitorBoardShell>
    </KanbanProvider>
  )
}
