'use client'

import {
  addDays,
  differenceInDays,
  differenceInHours,
  differenceInMonths,
  endOfDay,
  endOfMonth,
  format,
  formatDistance,
  getDate,
  getDaysInMonth,
  isSameDay,
  startOfDay,
  startOfMonth,
} from 'date-fns'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MonitorTimelineRange } from './view-config'

export type KiboGanttItem = {
  id: string
  title: string
  startAt: Date
  endAt: Date
  color: string
}

export type KiboGanttGroup = {
  id: string
  label: string
  items: KiboGanttItem[]
}

type KiboGanttProps = {
  groups: KiboGanttGroup[]
  range: MonitorTimelineRange
  zoom: number
  selectedItemId: string | null
  onSelectItem: (itemId: string) => void
}

type TimelineData = Array<{
  year: number
  quarters: Array<{
    months: Array<{
      days: number
    }>
  }>
}>

type GanttContextValue = {
  range: MonitorTimelineRange
  zoom: number
  columnWidth: number
  headerHeight: number
  rowHeight: number
  sidebarWidth: number
  timelineData: TimelineData
  scrollRegionRef: RefObject<HTMLDivElement | null>
  scrollToItem: (item: KiboGanttItem) => void
}

const HEADER_HEIGHT = 60
const ROW_HEIGHT = 36
const SIDEBAR_WIDTH = 300

const ganttContext = createContext<GanttContextValue | null>(null)

const useGanttContext = () => {
  const context = useContext(ganttContext)

  if (!context) {
    throw new Error('KiboGantt context is unavailable.')
  }

  return context
}

const createTimelineYear = (year: number) => ({
  year,
  quarters: new Array(4).fill(null).map((_, quarterIndex) => ({
    months: new Array(3).fill(null).map((_, monthIndex) => {
      const month = quarterIndex * 3 + monthIndex

      return {
        days: getDaysInMonth(new Date(year, month, 1)),
      }
    }),
  })),
})

const createInitialTimelineData = (today: Date): TimelineData => [
  createTimelineYear(today.getFullYear() - 1),
  createTimelineYear(today.getFullYear()),
  createTimelineYear(today.getFullYear() + 1),
]

const getBaseColumnWidth = (range: MonitorTimelineRange) => {
  if (range === 'daily') return 50
  if (range === 'quarterly') return 100
  return 150
}

const getDifferenceIn = (range: MonitorTimelineRange) =>
  range === 'daily' ? differenceInDays : differenceInMonths

const getInnerDifferenceIn = (range: MonitorTimelineRange) =>
  range === 'daily' ? differenceInHours : differenceInDays

const getStartOf = (range: MonitorTimelineRange) =>
  range === 'daily' ? startOfDay : startOfMonth

const getEndOf = (range: MonitorTimelineRange) =>
  range === 'daily' ? endOfDay : endOfMonth

const getColumnCount = (year: TimelineData[number], range: MonitorTimelineRange) => {
  if (range === 'daily') {
    return year.quarters.flatMap((quarter) => quarter.months).reduce((total, month) => total + month.days, 0)
  }

  return year.quarters.flatMap((quarter) => quarter.months).length
}

const getYearWidth = (
  year: TimelineData[number],
  range: MonitorTimelineRange,
  columnWidth: number,
  zoom: number
) => getColumnCount(year, range) * ((columnWidth * zoom) / 100)

const calculateInnerOffset = (
  date: Date,
  range: MonitorTimelineRange,
  columnWidth: number
) => {
  const startOf = getStartOf(range)
  const endOf = getEndOf(range)
  const differenceIn = getInnerDifferenceIn(range)
  const startOfRange = startOf(date)
  const endOfRange = endOf(date)
  const totalRangeDays = Math.max(differenceIn(endOfRange, startOfRange), 1)
  const positionWithinRange = range === 'daily' ? date.getHours() : date.getDate()

  return (positionWithinRange / totalRangeDays) * columnWidth
}

const getOffset = (
  date: Date,
  timelineStartDate: Date,
  context: Pick<GanttContextValue, 'columnWidth' | 'range' | 'timelineData' | 'zoom'>
) => {
  const parsedColumnWidth = (context.columnWidth * context.zoom) / 100
  const differenceIn = getDifferenceIn(context.range)
  const startOf = getStartOf(context.range)
  const fullColumns = differenceIn(startOf(date), timelineStartDate)

  if (context.range === 'daily') {
    return parsedColumnWidth * fullColumns
  }

  const partialColumns = date.getDate()
  const daysInMonth = getDaysInMonth(date)
  const pixelsPerDay = parsedColumnWidth / daysInMonth

  return fullColumns * parsedColumnWidth + partialColumns * pixelsPerDay
}

const getWidth = (
  startAt: Date,
  endAt: Date | null,
  context: Pick<GanttContextValue, 'columnWidth' | 'range' | 'zoom'>
) => {
  const parsedColumnWidth = (context.columnWidth * context.zoom) / 100

  if (!endAt) {
    return parsedColumnWidth * 2
  }

  const differenceIn = getDifferenceIn(context.range)

  if (context.range === 'daily') {
    const delta = differenceIn(endAt, startAt)

    return parsedColumnWidth * (delta || 1)
  }

  const daysInStartMonth = getDaysInMonth(startAt)
  const pixelsPerDayInStartMonth = parsedColumnWidth / daysInStartMonth

  if (isSameDay(startAt, endAt)) {
    return pixelsPerDayInStartMonth
  }

  const innerDifferenceIn = getInnerDifferenceIn(context.range)
  const startOf = getStartOf(context.range)

  if (isSameDay(startOf(startAt), startOf(endAt))) {
    return innerDifferenceIn(endAt, startAt) * pixelsPerDayInStartMonth
  }

  const startRangeOffset = daysInStartMonth - getDate(startAt)
  const endRangeOffset = getDate(endAt)
  const fullRangeOffset = differenceIn(startOf(endAt), startOf(startAt))
  const daysInEndMonth = getDaysInMonth(endAt)
  const pixelsPerDayInEndMonth = parsedColumnWidth / daysInEndMonth

  return (
    (fullRangeOffset - 1) * parsedColumnWidth +
    startRangeOffset * pixelsPerDayInStartMonth +
    endRangeOffset * pixelsPerDayInEndMonth
  )
}

function GanttHeaderBlock({
  columns,
  renderHeaderItem,
  title,
}: {
  columns: number
  renderHeaderItem: (index: number) => ReactNode
  title: string
}) {
  return (
    <div className='sticky top-0 z-20 grid w-full shrink-0 bg-card/95 backdrop-blur-sm' style={{ height: 'var(--gantt-header-height)' }}>
      <div>
        <div
          className='sticky inline-flex whitespace-nowrap px-3 py-2 text-muted-foreground text-xs'
          style={{ left: 'var(--gantt-sidebar-width)' }}
        >
          <p>{title}</p>
        </div>
      </div>
      <div className='grid w-full' style={{ gridTemplateColumns: `repeat(${columns}, var(--gantt-column-width))` }}>
        {Array.from({ length: columns }).map((_, index) => (
          <div key={`${title}:${index}`} className='shrink-0 border-b border-border/50 py-1 text-center text-xs'>
            {renderHeaderItem(index)}
          </div>
        ))}
      </div>
    </div>
  )
}

function GanttColumns({
  columns,
  isColumnSecondary,
}: {
  columns: number
  isColumnSecondary?: (index: number) => boolean
}) {
  return (
    <div className='grid h-full w-full divide-x divide-border/50' style={{ gridTemplateColumns: `repeat(${columns}, var(--gantt-column-width))` }}>
      {Array.from({ length: columns }).map((_, index) => (
        <div
          key={index}
          className={cn('h-full', isColumnSecondary?.(index) ? 'bg-secondary/60' : undefined)}
        />
      ))}
    </div>
  )
}

function DailyHeader() {
  const gantt = useGanttContext()

  return gantt.timelineData.map((year) =>
    year.quarters
      .flatMap((quarter) => quarter.months)
      .map((month, monthIndex) => (
        <div className='relative flex flex-col' key={`${year.year}-${monthIndex}`}>
          <GanttHeaderBlock
            columns={month.days}
            renderHeaderItem={(dayIndex) => {
              const date = addDays(new Date(year.year, monthIndex, 1), dayIndex)

              return (
                <div className='flex items-center justify-center gap-1'>
                  <p>{format(date, 'd')}</p>
                  <p className='text-muted-foreground'>{format(date, 'EEEEE')}</p>
                </div>
              )
            }}
            title={format(new Date(year.year, monthIndex, 1), 'MMMM yyyy')}
          />
          <GanttColumns
            columns={month.days}
            isColumnSecondary={(dayIndex) => [0, 6].includes(addDays(new Date(year.year, monthIndex, 1), dayIndex).getDay())}
          />
        </div>
      ))
  )
}

function MonthlyHeader() {
  const gantt = useGanttContext()

  return gantt.timelineData.map((year) => (
    <div className='relative flex flex-col' key={year.year}>
      <GanttHeaderBlock
        columns={year.quarters.flatMap((quarter) => quarter.months).length}
        renderHeaderItem={(monthIndex) => <p>{format(new Date(year.year, monthIndex, 1), 'MMM')}</p>}
        title={`${year.year}`}
      />
      <GanttColumns columns={year.quarters.flatMap((quarter) => quarter.months).length} />
    </div>
  ))
}

function QuarterlyHeader() {
  const gantt = useGanttContext()

  return gantt.timelineData.map((year) =>
    year.quarters.map((quarter, quarterIndex) => (
      <div className='relative flex flex-col' key={`${year.year}-${quarterIndex}`}>
        <GanttHeaderBlock
          columns={quarter.months.length}
          renderHeaderItem={(monthIndex) => (
            <p>{format(new Date(year.year, quarterIndex * 3 + monthIndex, 1), 'MMM')}</p>
          )}
          title={`Q${quarterIndex + 1} ${year.year}`}
        />
        <GanttColumns columns={quarter.months.length} />
      </div>
    ))
  )
}

function GanttHeader() {
  const gantt = useGanttContext()

  return (
    <div className='-space-x-px flex h-full w-max divide-x divide-border/50'>
      {gantt.range === 'daily' ? <DailyHeader /> : null}
      {gantt.range === 'monthly' ? <MonthlyHeader /> : null}
      {gantt.range === 'quarterly' ? <QuarterlyHeader /> : null}
    </div>
  )
}

function GanttSidebarItem({
  feature,
  isSelected,
  onSelectItem,
}: {
  feature: KiboGanttItem
  isSelected: boolean
  onSelectItem: (id: string) => void
}) {
  const gantt = useGanttContext()
  const endAt =
    feature.endAt && isSameDay(feature.startAt, feature.endAt)
      ? addDays(feature.endAt, 1)
      : feature.endAt
  const duration = endAt
    ? formatDistance(feature.startAt, endAt)
    : `${formatDistance(feature.startAt, new Date())} so far`

  return (
    <button
      type='button'
      className={cn(
        'flex w-full items-center gap-2.5 p-2.5 text-left text-xs transition-colors hover:bg-secondary',
        isSelected ? 'bg-accent/70' : undefined
      )}
      style={{ height: 'var(--gantt-row-height)' }}
      onClick={() => {
        gantt.scrollToItem(feature)
        onSelectItem(feature.id)
      }}
    >
      <div
        className='pointer-events-none h-2 w-2 shrink-0 rounded-full'
        style={{ backgroundColor: feature.color }}
      />
      <p className='pointer-events-none flex-1 truncate font-medium'>{feature.title}</p>
      <p className='pointer-events-none shrink-0 text-muted-foreground'>{duration}</p>
    </button>
  )
}

function GanttSidebar({ groups, selectedItemId, onSelectItem }: Pick<KiboGanttProps, 'groups' | 'selectedItemId' | 'onSelectItem'>) {
  const isEmptyDataset = groups.length === 0
  const renderedGroups = isEmptyDataset ? [{ id: 'current-view', label: 'Current view', items: [] }] : groups

  return (
    <div
      data-roadmap-ui='gantt-sidebar'
      data-testid='kibo-gantt-sidebar'
      className='sticky left-0 z-30 h-max min-h-full overflow-clip border-r border-border/50 bg-background/90 backdrop-blur-md'
    >
      <div
        className='sticky top-0 z-10 flex shrink-0 items-end justify-between gap-2.5 border-b border-border/50 bg-card/95 p-2.5 font-medium text-muted-foreground text-xs backdrop-blur-sm'
        style={{ height: 'var(--gantt-header-height)' }}
      >
        <p className='flex-1 truncate text-left'>Monitor</p>
        <p className='shrink-0'>Duration</p>
      </div>
      <div className='space-y-4'>
        {renderedGroups.map((group) => (
          <div key={group.id}>
            <p
              className='w-full truncate p-2.5 text-left font-medium text-muted-foreground text-xs'
              style={{ height: 'var(--gantt-row-height)' }}
            >
              {group.label}
            </p>
            <div className='divide-y divide-border/50'>
              {group.items.length === 0 ? (
                <div
                  className='flex items-center px-3 text-muted-foreground text-xs'
                  style={{ height: 'var(--gantt-row-height)' }}
                >
                  {isEmptyDataset
                    ? 'No monitors are available for the current timeline view.'
                    : 'No monitors in this lane.'}
                </div>
              ) : (
                group.items.map((item) => (
                  <GanttSidebarItem
                    key={item.id}
                    feature={item}
                    isSelected={selectedItemId === item.id}
                    onSelectItem={onSelectItem}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GanttFeatureItem({
  feature,
  isSelected,
  onSelectItem,
}: {
  feature: KiboGanttItem
  isSelected: boolean
  onSelectItem: (id: string) => void
}) {
  const gantt = useGanttContext()
  const timelineStartDate = useMemo(
    () => new Date(gantt.timelineData[0]?.year ?? new Date().getFullYear(), 0, 1),
    [gantt.timelineData]
  )
  const width = useMemo(
    () => getWidth(feature.startAt, feature.endAt, gantt),
    [feature.endAt, feature.startAt, gantt]
  )
  const offset = useMemo(
    () => getOffset(feature.startAt, timelineStartDate, gantt),
    [feature.startAt, gantt, timelineStartDate]
  )

  return (
    <div className='relative flex w-max min-w-full py-0.5' style={{ height: 'var(--gantt-row-height)' }}>
      <button
        type='button'
        className='absolute top-0.5 pointer-events-auto text-left'
        style={{
          height: 'calc(var(--gantt-row-height) - 4px)',
          left: Math.max(Math.round(offset), 0),
          width: Math.max(Math.round(width), 28),
        }}
        onClick={() => onSelectItem(feature.id)}
      >
        <Card
          className={cn(
            'h-full w-full rounded-md border bg-background p-0 text-xs shadow-sm transition-colors hover:bg-accent/40',
            isSelected ? 'ring-2 ring-primary/40' : undefined
          )}
        >
          <div className='flex h-full items-center gap-2 px-2 text-left'>
            <div
              className='h-full w-1 shrink-0 rounded-full'
              style={{ backgroundColor: feature.color }}
            />
            <p className='flex-1 truncate font-medium'>{feature.title}</p>
          </div>
        </Card>
      </button>
    </div>
  )
}

function GanttFeatureList({
  groups,
  selectedItemId,
  onSelectItem,
}: Pick<KiboGanttProps, 'groups' | 'selectedItemId' | 'onSelectItem'>) {
  const isEmptyDataset = groups.length === 0
  const renderedGroups = isEmptyDataset ? [{ id: 'current-view', label: 'Current view', items: [] }] : groups

  return (
    <div className='absolute top-0 left-0 h-full w-max space-y-4' style={{ marginTop: 'var(--gantt-header-height)' }}>
      {renderedGroups.map((group) => (
        <div key={group.id} style={{ paddingTop: 'var(--gantt-row-height)' }}>
          {group.items.length === 0 ? (
            <div
              className='flex items-center px-3 text-muted-foreground text-xs'
              style={{ height: 'var(--gantt-row-height)' }}
            >
              {isEmptyDataset
                ? 'No monitors are available for the current timeline view.'
                : 'No monitors in this lane.'}
            </div>
          ) : (
            group.items.map((item) => (
              <GanttFeatureItem
                key={item.id}
                feature={item}
                isSelected={selectedItemId === item.id}
                onSelectItem={onSelectItem}
              />
            ))
          )}
        </div>
      ))}
    </div>
  )
}

function GanttToday() {
  const date = useMemo(() => new Date(), [])
  const gantt = useGanttContext()
  const differenceIn = useMemo(() => getDifferenceIn(gantt.range), [gantt.range])
  const timelineStartDate = useMemo(
    () => new Date(gantt.timelineData[0]?.year ?? new Date().getFullYear(), 0, 1),
    [gantt.timelineData]
  )
  const offset = useMemo(() => differenceIn(date, timelineStartDate), [date, differenceIn, timelineStartDate])
  const innerOffset = useMemo(
    () => calculateInnerOffset(date, gantt.range, (gantt.columnWidth * gantt.zoom) / 100),
    [date, gantt.columnWidth, gantt.range, gantt.zoom]
  )

  return (
    <div
      className='pointer-events-none absolute top-0 left-0 z-20 flex h-full w-0 select-none flex-col items-center justify-center overflow-visible'
      style={{
        transform: `translateX(calc(var(--gantt-column-width) * ${offset} + ${innerOffset}px))`,
      }}
    >
      <div className='pointer-events-auto sticky top-0 flex flex-col items-center rounded-b-md bg-card px-2 py-1 text-foreground text-xs shadow-sm'>
        Today
        <span className='opacity-80'>{format(date, 'MMM dd, yyyy')}</span>
      </div>
      <div className='h-full w-px bg-primary/60' />
    </div>
  )
}

export function KiboGantt({
  groups,
  range,
  zoom,
  selectedItemId,
  onSelectItem,
}: KiboGanttProps) {
  const [timelineData, setTimelineData] = useState<TimelineData>(() => createInitialTimelineData(new Date()))
  const scrollRegionRef = useRef<HTMLDivElement>(null)
  const pendingPrependWidthRef = useRef(0)
  const isExtendingTimelineRef = useRef(false)
  const previousRangeRef = useRef<MonitorTimelineRange | null>(null)
  const columnWidth = getBaseColumnWidth(range)

  const cssVariables = useMemo(
    () =>
      ({
        '--gantt-column-width': `${(zoom / 100) * columnWidth}px`,
        '--gantt-header-height': `${HEADER_HEIGHT}px`,
        '--gantt-row-height': `${ROW_HEIGHT}px`,
        '--gantt-sidebar-width': `${SIDEBAR_WIDTH}px`,
      }) as CSSProperties,
    [columnWidth, zoom]
  )

  useEffect(() => {
    if (pendingPrependWidthRef.current === 0 || !scrollRegionRef.current) {
      isExtendingTimelineRef.current = false
      return
    }

    scrollRegionRef.current.scrollLeft += pendingPrependWidthRef.current
    pendingPrependWidthRef.current = 0
    isExtendingTimelineRef.current = false
  }, [timelineData])

  useEffect(() => {
    if (!scrollRegionRef.current) return

    const rangeChanged = previousRangeRef.current !== range
    previousRangeRef.current = range

    if (!rangeChanged) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const scrollRegion = scrollRegionRef.current

      if (!scrollRegion) return

      scrollRegion.scrollLeft = scrollRegion.scrollWidth / 2 - scrollRegion.clientWidth / 2
    })

    return () => window.cancelAnimationFrame(frame)
  }, [range])

  const contextValue = useMemo<GanttContextValue>(
    () => ({
      range,
      zoom,
      columnWidth,
      headerHeight: HEADER_HEIGHT,
      rowHeight: ROW_HEIGHT,
      sidebarWidth: SIDEBAR_WIDTH,
      timelineData,
      scrollRegionRef,
      scrollToItem: (item) => {
        const scrollRegion = scrollRegionRef.current

        if (!scrollRegion) return

        const timelineStartDate = new Date(timelineData[0]?.year ?? new Date().getFullYear(), 0, 1)
        const offset = getOffset(item.startAt, timelineStartDate, {
          columnWidth,
          range,
          timelineData,
          zoom,
        })

        const nextLeft = Math.max(offset, 0)

        if (typeof scrollRegion.scrollTo === 'function') {
          scrollRegion.scrollTo({
            left: nextLeft,
            behavior: 'smooth',
          })
          return
        }

        scrollRegion.scrollLeft = nextLeft
      },
    }),
    [columnWidth, range, timelineData, zoom]
  )

  const handleScroll = () => {
    const scrollRegion = scrollRegionRef.current

    if (!scrollRegion || isExtendingTimelineRef.current) {
      return
    }

    const { clientWidth, scrollLeft, scrollWidth } = scrollRegion

    if (scrollLeft <= 1) {
      isExtendingTimelineRef.current = true
      setTimelineData((current) => {
        const firstYear = current[0]?.year

        if (!firstYear) {
          return current
        }

        const nextYear = createTimelineYear(firstYear - 1)
        pendingPrependWidthRef.current = getYearWidth(nextYear, range, columnWidth, zoom)
        return [nextYear, ...current]
      })
      return
    }

    if (scrollLeft + clientWidth >= scrollWidth - 1) {
      isExtendingTimelineRef.current = true
      setTimelineData((current) => {
        const lastYear = current.at(-1)?.year

        if (!lastYear) {
          return current
        }

        return [...current, createTimelineYear(lastYear + 1)]
      })
    }
  }

  return (
    <ganttContext.Provider value={contextValue}>
      <div
        ref={scrollRegionRef}
        data-testid='kibo-gantt-scroll-region'
        className='gantt relative isolate grid h-full w-full flex-none select-none overflow-auto rounded-xl border bg-secondary'
        style={{
          ...cssVariables,
          gridTemplateColumns: 'var(--gantt-sidebar-width) 1fr',
        }}
        onScroll={handleScroll}
      >
        <GanttSidebar groups={groups} selectedItemId={selectedItemId} onSelectItem={onSelectItem} />

        <div data-testid='kibo-gantt-timeline' className='relative flex h-full w-max flex-none overflow-clip'>
          <GanttHeader />
          <GanttFeatureList
            groups={groups}
            selectedItemId={selectedItemId}
            onSelectItem={onSelectItem}
          />
          <GanttToday />
        </div>
      </div>
    </ganttContext.Provider>
  )
}
