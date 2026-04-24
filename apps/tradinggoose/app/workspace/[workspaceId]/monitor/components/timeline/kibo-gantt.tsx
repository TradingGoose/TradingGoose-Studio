'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addHours,
  addMinutes,
  addWeeks,
  startOfDay,
  startOfHour,
  startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import {
  formatMonitorTimelineHeaderGroup,
  formatMonitorTimelinePrimaryLabel,
  formatMonitorTimelineTickTitle,
  getMonitorTimelineBoundaryBucket,
  getMonitorTimelineHeaderGroupId,
} from '../shared/monitor-time'
import {
  MONITOR_TIMELINE_SCALE_MAX,
  MONITOR_TIMELINE_SCALE_MIN,
  MONITOR_TIMELINE_SCALE_STEP,
  MONITOR_TIMELINE_ZOOM,
  type MonitorFieldSum,
  type MonitorTimelineZoom,
} from '../view/view-config'

export type KiboGanttItem = {
  id: string
  title: string
  startAt: Date
  endAt: Date
  isOrphaned: boolean
  isPartial: boolean
  color: string
}

export type KiboGanttGroup = {
  id: string
  label: string
  aggregates?: Partial<Record<MonitorFieldSum, number>>
  items: KiboGanttItem[]
}

type KiboGanttProps = {
  groups: KiboGanttGroup[]
  zoom: MonitorTimelineZoom
  scale: number
  timezone: string
  selectedItemId: string | null
  showTodayMarker: boolean
  showIntervalBoundaries: boolean
  controlsDisabled: boolean
  onSelectItem: (itemId: string) => void
  onZoomChange?: (zoom: MonitorTimelineZoom) => void
  onScaleChange?: (scale: number) => void
}

type TimelineWindow = {
  start: Date
  end: Date
}

type TimelineHeaderGroup = {
  id: string
  label: string
  columnCount: number
}

type TimelineDensity = {
  bucketMinutes: number
}

const MINUTE_MS = 60_000
const TIMELINE_ITEM_HEIGHT = 32
const TIMELINE_ITEM_GAP = 8
const TIMELINE_ROW_PADDING = 10
const FIELD_SUM_LABELS: Record<MonitorFieldSum, string> = {
  count: 'Count',
  durationMs: 'Duration',
  cost: 'Cost',
}

const TIMELINE_ZOOM_LABELS: Record<MonitorTimelineZoom, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

const getTimelinePaddingUnits = (zoom: MonitorTimelineZoom) => {
  switch (zoom) {
    case 'day':
      return 24
    case 'week':
      return 14
    case 'month':
      return 8
  }
}

const getTimelineExtensionUnits = (zoom: MonitorTimelineZoom) => {
  switch (zoom) {
    case 'day':
      return 24
    case 'week':
      return 14
    case 'month':
      return 8
  }
}

const startOfTimelineUnit = (date: Date, zoom: MonitorTimelineZoom) => {
  switch (zoom) {
    case 'day':
      return startOfHour(date)
    case 'week':
      return startOfDay(date)
    case 'month':
      return startOfWeek(date, { weekStartsOn: 1 })
  }
}

const addTimelineUnits = (date: Date, zoom: MonitorTimelineZoom, units: number) => {
  switch (zoom) {
    case 'day':
      return addHours(date, units)
    case 'week':
      return addDays(date, units)
    case 'month':
      return addWeeks(date, units)
  }
}

const getBaseColumnWidth = (zoom: MonitorTimelineZoom) => {
  switch (zoom) {
    case 'day':
      return 72
    case 'week':
      return 96
    case 'month':
      return 144
  }
}

const getBaseUnitMinutes = (zoom: MonitorTimelineZoom) => {
  switch (zoom) {
    case 'day':
      return 60
    case 'week':
      return 24 * 60
    case 'month':
      return 7 * 24 * 60
  }
}

const getTimelineDensity = (zoom: MonitorTimelineZoom, scale: number): TimelineDensity => {
  switch (zoom) {
    case 'day':
      if (scale >= 160) return { bucketMinutes: 15 }
      if (scale >= 120) return { bucketMinutes: 30 }
      return { bucketMinutes: 60 }
    case 'week':
      if (scale >= 160) return { bucketMinutes: 6 * 60 }
      if (scale >= 120) return { bucketMinutes: 12 * 60 }
      return { bucketMinutes: 24 * 60 }
    case 'month':
      if (scale >= 160) return { bucketMinutes: 24 * 60 }
      return { bucketMinutes: 7 * 24 * 60 }
  }
}

const getColumnWidth = (zoom: MonitorTimelineZoom, scale: number, density: TimelineDensity) =>
  Math.max(
    24,
    Math.round(
      ((getBaseColumnWidth(zoom) * scale) / 100) *
      (density.bucketMinutes / getBaseUnitMinutes(zoom))
    )
  )

const getTimelineSeed = (groups: KiboGanttGroup[]) =>
  groups
    .flatMap((group) =>
      group.items.map((item) => [item.id, item.startAt.getTime(), item.endAt.getTime()])
    )
    .flat()
    .join(':')

const getTimelineBounds = (groups: KiboGanttGroup[], zoom: MonitorTimelineZoom): TimelineWindow => {
  const items = groups.flatMap((group) => group.items)
  const today = new Date()
  const starts = items.map((item) => item.startAt.getTime()).concat(today.getTime())
  const ends = items.map((item) => item.endAt.getTime()).concat(today.getTime())
  const min = new Date(Math.min(...starts))
  const max = new Date(Math.max(...ends))
  const padding = getTimelinePaddingUnits(zoom)

  return {
    start: addTimelineUnits(startOfTimelineUnit(min, zoom), zoom, -padding),
    end: addTimelineUnits(startOfTimelineUnit(max, zoom), zoom, padding),
  }
}

const buildColumns = (start: Date, end: Date, density: TimelineDensity) => {
  const columns: Date[] = []
  let cursor = new Date(start)

  while (cursor <= end) {
    columns.push(new Date(cursor))
    cursor = addMinutes(cursor, density.bucketMinutes)
  }

  return columns
}

const getGroupRowHeight = (itemCount: number) => {
  if (itemCount === 0) {
    return TIMELINE_ITEM_HEIGHT
  }

  return Math.max(
    TIMELINE_ITEM_HEIGHT,
    TIMELINE_ROW_PADDING * 2 +
    itemCount * TIMELINE_ITEM_HEIGHT +
    Math.max(0, itemCount - 1) * TIMELINE_ITEM_GAP
  )
}

const getGroupItemTop = (index: number) =>
  TIMELINE_ROW_PADDING + index * (TIMELINE_ITEM_HEIGHT + TIMELINE_ITEM_GAP)

const getBoundaryBucket = (column: Date, zoom: MonitorTimelineZoom, timezone: string) =>
  getMonitorTimelineBoundaryBucket(column, zoom, timezone)

const buildHeaderGroups = (
  columns: Date[],
  headerGroupIds: string[],
  zoom: MonitorTimelineZoom,
  timezone: string
): TimelineHeaderGroup[] => {
  const groups: TimelineHeaderGroup[] = []

  columns.forEach((column, index) => {
    const groupId = headerGroupIds[index] ?? getMonitorTimelineHeaderGroupId(column, zoom, timezone)
    const current = groups[groups.length - 1]

    if (current?.id === groupId) {
      current.columnCount += 1
      return
    }

    groups.push({
      id: groupId,
      label: formatMonitorTimelineHeaderGroup(column, zoom, timezone),
      columnCount: 1,
    })
  })

  return groups
}

const getColumnPrimaryLabel = (column: Date, zoom: MonitorTimelineZoom, timezone: string) =>
  formatMonitorTimelinePrimaryLabel(column, zoom, timezone)

const getColumnTickTitle = (column: Date, zoom: MonitorTimelineZoom, timezone: string) =>
  formatMonitorTimelineTickTitle(column, zoom, timezone)

const getMinimumTickSpacing = (zoom: MonitorTimelineZoom, density: TimelineDensity) => {
  switch (zoom) {
    case 'day':
      if (density.bucketMinutes <= 15) return 58
      if (density.bucketMinutes <= 30) return 42
      return 96
    case 'week':
      if (density.bucketMinutes <= 6 * 60) return 130
      if (density.bucketMinutes < 24 * 60) return 72
      return 96
    case 'month':
      return 72
  }
}

const getTickLabelStep = (
  zoom: MonitorTimelineZoom,
  columnWidth: number,
  density: TimelineDensity
) => Math.max(1, Math.ceil(getMinimumTickSpacing(zoom, density) / columnWidth))

const shouldShowColumnTick = ({
  columnWidth,
  density,
  headerGroupIds,
  index,
  zoom,
}: {
  columnWidth: number
  density: TimelineDensity
  headerGroupIds: string[]
  index: number
  zoom: MonitorTimelineZoom
}) => {
  if (index === 0) return true
  if (headerGroupIds[index - 1] !== headerGroupIds[index]) {
    return true
  }

  return index % getTickLabelStep(zoom, columnWidth, density) === 0
}

const getDateOffset = (
  target: Date,
  columns: Date[],
  density: TimelineDensity,
  columnWidth: number
) => {
  const firstColumn = columns[0]
  if (!firstColumn) return 0

  const elapsedMs = target.getTime() - firstColumn.getTime()
  return Math.max(0, (elapsedMs / (density.bucketMinutes * MINUTE_MS)) * columnWidth)
}

const getItemMetrics = (
  item: KiboGanttItem,
  columns: Date[],
  density: TimelineDensity,
  columnWidth: number
) => {
  const startOffset = getDateOffset(item.startAt, columns, density, columnWidth)
  const endOffset = getDateOffset(item.endAt, columns, density, columnWidth)

  return {
    left: startOffset,
    width: Math.max(24, endOffset - startOffset),
  }
}

const formatAggregateValue = (field: string, value: unknown) => {
  if (typeof value !== 'number') {
    return String(value)
  }

  if (field === 'count') {
    return value.toFixed(0)
  }
  if (field === 'cost') {
    return `$${value.toFixed(4)}`
  }
  if (field === 'durationMs') {
    return `${value.toFixed(0)}ms`
  }

  return value.toFixed(2)
}

const differenceInColumnUnits = (right: Date, left: Date, density: TimelineDensity) =>
  Math.ceil((right.getTime() - left.getTime()) / (density.bucketMinutes * MINUTE_MS))

export function KiboGantt({
  groups,
  zoom,
  scale,
  timezone,
  selectedItemId,
  showTodayMarker,
  showIntervalBoundaries,
  controlsDisabled,
  onSelectItem,
  onZoomChange,
  onScaleChange,
}: KiboGanttProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingScrollAdjustmentRef = useRef(0)
  const centeredSeedRef = useRef<string | null>(null)
  const renderedGroups = groups.length
    ? groups
    : [{ id: 'current-view', label: 'Current view', aggregates: {}, items: [] }]
  const timelineDensity = useMemo(() => getTimelineDensity(zoom, scale), [scale, zoom])
  const timelineSeed = useMemo(() => getTimelineSeed(groups), [groups])
  const initialWindow = useMemo(() => getTimelineBounds(groups, zoom), [timelineSeed, zoom])
  const initialWindowKey = `${zoom}:${initialWindow.start.toISOString()}:${initialWindow.end.toISOString()}`
  const [timelineWindow, setTimelineWindow] = useState<TimelineWindow>(initialWindow)
  const columns = useMemo(
    () => buildColumns(timelineWindow.start, timelineWindow.end, timelineDensity),
    [timelineDensity, timelineWindow.end, timelineWindow.start]
  )
  const headerGroupIds = useMemo(
    () => columns.map((column) => getMonitorTimelineHeaderGroupId(column, zoom, timezone)),
    [columns, timezone, zoom]
  )
  const headerGroups = useMemo(
    () => buildHeaderGroups(columns, headerGroupIds, zoom, timezone),
    [columns, headerGroupIds, timezone, zoom]
  )
  const columnWidth = getColumnWidth(zoom, scale, timelineDensity)
  const todayOffset = getDateOffset(new Date(), columns, timelineDensity, columnWidth)
  const intervalBoundaryIndexes = showIntervalBoundaries
    ? columns
      .map((column, index) =>
        index > 0 &&
          getBoundaryBucket(columns[index - 1]!, zoom, timezone) !==
          getBoundaryBucket(column, zoom, timezone)
          ? index
          : null
      )
      .filter((index): index is number => index !== null)
    : []

  useEffect(() => {
    setTimelineWindow(initialWindow)
    centeredSeedRef.current = null
  }, [initialWindowKey, initialWindow])

  useLayoutEffect(() => {
    if (pendingScrollAdjustmentRef.current === 0 || !scrollRef.current) {
      return
    }

    scrollRef.current.scrollLeft += pendingScrollAdjustmentRef.current
    pendingScrollAdjustmentRef.current = 0
  }, [timelineWindow.start])

  useLayoutEffect(() => {
    if (!scrollRef.current || centeredSeedRef.current === initialWindowKey) {
      return
    }

    const scrollElement = scrollRef.current
    const targetLeft = Math.max(0, todayOffset - scrollElement.clientWidth / 2)
    scrollElement.scrollLeft = targetLeft
    centeredSeedRef.current = initialWindowKey
  }, [initialWindowKey, todayOffset])

  const extendTimeline = (direction: 'past' | 'future') => {
    const extensionUnits = getTimelineExtensionUnits(zoom)

    setTimelineWindow((current) => {
      if (direction === 'past') {
        const nextStart = addTimelineUnits(current.start, zoom, -extensionUnits)
        const addedColumns = Math.max(
          0,
          differenceInColumnUnits(current.start, nextStart, timelineDensity)
        )
        pendingScrollAdjustmentRef.current += addedColumns * columnWidth
        return {
          ...current,
          start: nextStart,
        }
      }

      return {
        ...current,
        end: addTimelineUnits(current.end, zoom, extensionUnits),
      }
    })
  }

  const handleScroll = () => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const threshold = columnWidth * 2
    const nearStart = scrollElement.scrollLeft <= threshold
    const nearEnd =
      scrollElement.scrollLeft + scrollElement.clientWidth >= scrollElement.scrollWidth - threshold

    if (nearStart) {
      extendTimeline('past')
    } else if (nearEnd) {
      extendTimeline('future')
    }
  }

  const scrollToToday = () => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    scrollElement.scrollLeft = Math.max(0, todayOffset - scrollElement.clientWidth / 2)
  }

  const scrollDateRange = (direction: 'previous' | 'next') => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const fallbackDistance = columnWidth * (zoom === 'day' ? 12 : 7)
    const distance = scrollElement.clientWidth > 0 ? scrollElement.clientWidth : fallbackDistance
    scrollElement.scrollLeft += direction === 'next' ? distance : -distance
  }

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card/40'>
      <div className='flex h-11 shrink-0 items-center gap-3 border-b px-2'>
        <div className='shrink-0 px-2 font-medium text-sm'>Timeline</div>
        <div
          role='menubar'
          aria-label='Timeline range controls'
          className='flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          <div className='flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-muted-foreground text-xs'>
            <span className='shrink-0'>Scale</span>
            <Slider
              aria-label='Timeline scale'
              className='w-28'
              disabled={controlsDisabled}
              min={MONITOR_TIMELINE_SCALE_MIN}
              max={MONITOR_TIMELINE_SCALE_MAX}
              step={MONITOR_TIMELINE_SCALE_STEP}
              value={[scale]}
              onValueChange={(value) => {
                const nextScale = value[0]
                if (typeof nextScale === 'number') {
                  onScaleChange?.(nextScale)
                }
              }}
            />
            <span className='min-w-10 text-right tabular-nums'>{scale}%</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-8 shrink-0 rounded-md px-2'
                disabled={controlsDisabled}
                aria-label={`Timeline zoom: ${TIMELINE_ZOOM_LABELS[zoom]}`}
              >
                <ZoomIn className='h-4 w-4' />
                <span>{TIMELINE_ZOOM_LABELS[zoom]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              <DropdownMenuLabel>Zoom level</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={zoom}
                onValueChange={(value) => onZoomChange?.(value as MonitorTimelineZoom)}
              >
                {MONITOR_TIMELINE_ZOOM.map((timelineZoom) => (
                  <DropdownMenuRadioItem key={timelineZoom} value={timelineZoom}>
                    {TIMELINE_ZOOM_LABELS[timelineZoom]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-8 shrink-0 rounded-md px-2'
            disabled={controlsDisabled}
            onClick={scrollToToday}
          >
            Today
          </Button>

          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8 shrink-0 rounded-md'
            disabled={controlsDisabled}
            aria-label='Scroll to previous date range'
            onClick={() => scrollDateRange('previous')}
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-8 w-8 shrink-0 rounded-md'
            disabled={controlsDisabled}
            aria-label='Scroll to next date range'
            onClick={() => scrollDateRange('next')}
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 overflow-hidden'>
        <div className='w-[240px] shrink-0 border-r bg-background/70'>
          <div className='flex h-16 items-center border-b px-4 text-muted-foreground text-sm'>
            Groups
          </div>
          <div className='divide-y'>
            {renderedGroups.map((group) => {
              const aggregateEntries = Object.entries(group.aggregates ?? {})
              const isEmptyGroup = group.items.length === 0

              return (
                <div
                  key={group.id}
                  className={cn(
                    'flex px-4',
                    isEmptyGroup ? 'items-center gap-2' : 'flex-col justify-center'
                  )}
                  style={{ height: getGroupRowHeight(group.items.length) }}
                >
                  <div className='truncate font-medium text-sm'>{group.label}</div>
                  <div className='text-muted-foreground text-xs'>
                    {group.items.length} executions
                  </div>
                  {aggregateEntries.length > 0 ? (
                    <div className='mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground'>
                      {aggregateEntries.map(([field, value]) => (
                        <span key={field} className='rounded bg-muted/60 px-1.5 py-0.5'>
                          {FIELD_SUM_LABELS[field as MonitorFieldSum] ?? field}:{' '}
                          {formatAggregateValue(field, value)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div
          ref={scrollRef}
          data-testid='kibo-timeline-scroll'
          className='min-h-0 min-w-0 flex-1 overflow-auto'
          onScroll={handleScroll}
        >
          <div className='sticky top-0 z-20 bg-card/95 backdrop-blur'>
            <div className='flex h-8 border-b'>
              {headerGroups.map((group) => (
                <div
                  key={`${zoom}:group:${group.id}`}
                  data-testid='kibo-timeline-header-group'
                  className='flex shrink-0 items-center border-r px-3 font-medium text-muted-foreground text-xs'
                  style={{ width: group.columnCount * columnWidth }}
                >
                  <span className='sticky left-2 truncate'>{group.label}</span>
                </div>
              ))}
            </div>
            <div className='flex h-8' data-testid='kibo-timeline-column-grid'>
              {columns.map((column, index) => {
                const showTick = shouldShowColumnTick({
                  columnWidth,
                  density: timelineDensity,
                  headerGroupIds,
                  index,
                  zoom,
                })

                return (
                  <div
                    key={`${zoom}:${column.toISOString()}`}
                    data-testid='kibo-timeline-column'
                    className='flex shrink-0 items-center justify-center overflow-hidden border-r border-b px-0.5 text-center font-medium text-[11px] text-muted-foreground'
                    style={{ width: columnWidth }}
                  >
                    {showTick ? (
                      <time
                        dateTime={column.toISOString()}
                        title={getColumnTickTitle(column, zoom, timezone)}
                        className='block min-w-0 max-w-full truncate tabular-nums'
                      >
                        {getColumnPrimaryLabel(column, zoom, timezone)}
                      </time>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          <div className='relative'>
            {showTodayMarker ? (
              <div
                className='pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-primary'
                data-testid='kibo-today-marker'
                style={{ left: todayOffset }}
              />
            ) : null}
            {intervalBoundaryIndexes.map((index) => (
              <div
                key={`boundary:${zoom}:${index}`}
                className='pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-foreground/20'
                data-testid='kibo-interval-boundary-marker'
                style={{ left: index * columnWidth }}
              />
            ))}

            {renderedGroups.map((group) => {
              const rowHeight = getGroupRowHeight(group.items.length)

              return (
                <div
                  key={group.id}
                  className='relative'
                  data-testid={`kibo-row-${group.id}`}
                  style={{
                    minWidth: columns.length * columnWidth,
                    height: rowHeight,
                  }}
                >
                  <div
                    className='absolute inset-0 flex'
                    aria-hidden='true'
                    data-testid={`kibo-row-${group.id}-grid`}
                  >
                    {columns.map((column) => (
                      <div
                        key={`${group.id}:grid:${zoom}:${column.toISOString()}`}
                        className='h-full shrink-0 border-b'
                        style={{ width: columnWidth }}
                      />
                    ))}
                  </div>
                  <div className='relative z-[1]' style={{ height: rowHeight }}>
                    {group.items.length === 0 ? (
                      <div className='flex h-full items-center px-4 text-muted-foreground text-sm'>
                        No executions in this group
                      </div>
                    ) : (
                      group.items.map((item, index) => {
                        const metrics = getItemMetrics(item, columns, timelineDensity, columnWidth)
                        return (
                          <button
                            key={item.id}
                            type='button'
                            className={cn(
                              'absolute flex items-center rounded-md px-3 text-left text-xs text-white shadow-sm transition hover:opacity-90',
                              selectedItemId === item.id &&
                              'ring-2 ring-primary ring-offset-2 ring-offset-background'
                            )}
                            style={{
                              left: metrics.left + 8,
                              top: getGroupItemTop(index),
                              height: TIMELINE_ITEM_HEIGHT,
                              width: Math.max(96, metrics.width - 16),
                              backgroundColor: item.color,
                            }}
                            onClick={() => onSelectItem(item.id)}
                          >
                            <span className='truncate'>{item.title}</span>
                            {item.isOrphaned ? (
                              <span className='ml-2 rounded bg-black/20 px-1.5 py-0.5 text-[10px]'>
                                Orphaned
                              </span>
                            ) : null}
                            {item.isPartial ? (
                              <span className='ml-2 rounded bg-black/20 px-1.5 py-0.5 text-[10px]'>
                                Partial
                              </span>
                            ) : null}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
