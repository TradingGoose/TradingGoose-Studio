'use client'

import { type ReactNode, type WheelEvent, useCallback, useMemo, useRef } from 'react'
import { Loader2, SquareChartGantt, SquareKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components/log-details/log-details'
import { buildMonitorBoardSections } from '../board/board-state'
import { MonitorBoard } from '../board/monitor-board'
import { MonitorTimezoneMenu } from '../controls/monitor-timezone-menu'
import { getExecutionGroupValue, type MonitorExecutionItem } from '../data/execution-ordering'
import { MonitorRoadmap } from '../timeline/monitor-roadmap'
import { buildMonitorRoadmapGroups } from '../timeline/roadmap-state'
import {
  MONITOR_FIELD_SUMS,
  MONITOR_GROUP_FIELDS,
  MONITOR_SORT_FIELDS,
  MONITOR_TIMELINE_SCALE_MAX,
  MONITOR_TIMELINE_SCALE_MIN,
  MONITOR_VISIBLE_FIELDS,
  type MonitorFieldSum,
  type MonitorGroupField,
  type MonitorQuickFilterField,
  type MonitorSortField,
  type MonitorTimelineZoom,
  type MonitorViewConfig,
} from '../view/view-config'

type MonitorExecutionWorkspaceProps = {
  viewStateMode: 'loading' | 'server' | 'error'
  viewStateReloading: boolean
  viewsError: string | null
  effectiveConfig: MonitorViewConfig
  isCreateViewDialogOpen: boolean
  nameDialogValue: string
  nameDialogBusy: boolean
  executionItems: MonitorExecutionItem[]
  executionsLoading: boolean
  executionsError: string | null
  selectedExecutionLogId: string | null
  selectedExecution: MonitorExecutionItem | null
  selectedExecutionLog: MonitorExecutionItem['sourceLog'] | null
  inspectorLoading: boolean
  inspectorError: string | null
  innerPanelSizes: [number, number] | null
  onInnerPanelLayout: (sizes: number[]) => void
  onUpdateViewConfig: (
    next: MonitorViewConfig | ((current: MonitorViewConfig) => MonitorViewConfig)
  ) => void
  onToggleQuickFilter: (field: MonitorQuickFilterField, value: string) => void
  isQuickFilterActive: (field: MonitorQuickFilterField, value: string) => boolean
  onReorderColumnCards: (columnId: string, nextExecutionIds: string[]) => void
  onSelectExecution: (logId: string | null) => void
  onNavigatePrev: () => void
  onNavigateNext: () => void
  hasPrev: boolean
  hasNext: boolean
  onChangeNameDialogValue: (value: string) => void
  onCloseNameDialog: () => void
  onSubmitNameDialog: () => void
  onReloadViews: () => void
}

const GROUP_FIELD_LABELS: Record<MonitorGroupField, string> = {
  outcome: 'Outcome',
  workflow: 'Workflow',
  trigger: 'Trigger',
  listing: 'Listing',
  assetType: 'Asset type',
  provider: 'Provider',
  interval: 'Interval',
  monitor: 'Monitor',
}

const SORT_FIELD_LABELS: Record<MonitorSortField, string> = {
  startedAt: 'Started at',
  endedAt: 'Ended at',
  durationMs: 'Duration',
  cost: 'Cost',
  workflowName: 'Workflow',
  providerId: 'Provider',
  interval: 'Interval',
  listingLabel: 'Listing',
}

const FIELD_SUM_LABELS: Record<MonitorFieldSum, string> = {
  count: 'Count',
  durationMs: 'Duration',
  cost: 'Cost',
}

const VISIBLE_FIELD_LABELS = {
  workflow: 'Workflow',
  provider: 'Provider',
  interval: 'Interval',
  assetType: 'Asset type',
  trigger: 'Trigger',
  startedAt: 'Started at',
  endedAt: 'Ended at',
  durationMs: 'Duration',
  cost: 'Cost',
  monitor: 'Monitor',
} as const

const DEFAULT_COLUMN_LIMITS = [0, 5, 10, 20] as const

const getDefaultSortDirection = (field: MonitorSortField) => {
  switch (field) {
    case 'startedAt':
    case 'endedAt':
    case 'durationMs':
    case 'cost':
      return 'desc' as const
    default:
      return 'asc' as const
  }
}

const getTimelineMarkersLabel = (markers: MonitorViewConfig['timeline']['markers']) => {
  const activeMarkers = [
    markers.today ? 'Today' : null,
    markers.intervalBoundaries ? 'Boundaries' : null,
  ].filter(Boolean)

  return activeMarkers.length > 0 ? activeMarkers.join(', ') : 'None'
}

function ToolbarMenu({
  label,
  value,
  disabled,
  className,
  children,
}: {
  label: string
  value?: string
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn('h-8 shrink-0 gap-2 rounded-md', className)}
          disabled={disabled}
        >
          <span className='shrink-0'>{label}</span>
          {value ? (
            <span className='max-w-[180px] truncate text-muted-foreground'>{value}</span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='max-h-[420px] overflow-y-auto'>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ExecutionContextStrip({ execution }: { execution: MonitorExecutionItem }) {
  return (
    <div className='border-b bg-muted/30 px-3 py-3'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='font-medium text-foreground'>{execution.workflowName}</span>
        <span className='rounded-sm bg-background px-2 py-1 text-muted-foreground'>
          {execution.outcome}
        </span>
        {execution.monitorId ? (
          <span className='rounded-sm bg-background px-2 py-1 text-muted-foreground'>
            {execution.monitorId}
          </span>
        ) : null}
        {execution.providerId ? (
          <span className='rounded-sm bg-background px-2 py-1 text-muted-foreground'>
            {execution.providerId}
          </span>
        ) : null}
        {execution.interval ? (
          <span className='rounded-sm bg-background px-2 py-1 text-muted-foreground'>
            {execution.interval}
          </span>
        ) : null}
        {execution.isOrphaned ? (
          <span className='rounded-sm bg-red-500/10 px-2 py-1 text-red-600'>
            Source monitor unavailable
          </span>
        ) : null}
        {execution.isPartial ? (
          <span className='rounded-sm bg-amber-500/10 px-2 py-1 text-amber-700'>
            Snapshot incomplete
          </span>
        ) : null}
      </div>
    </div>
  )
}

function InspectorState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className='flex h-full items-center justify-center rounded-xl border bg-card/50 px-6 text-center'>
      <div className='space-y-3'>
        <div className='space-y-1'>
          <div className='font-medium text-sm'>{title}</div>
          <div className='max-w-sm text-muted-foreground text-sm'>{description}</div>
        </div>
        <Button variant='outline' size='sm' onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

export function MonitorExecutionWorkspace({
  viewStateMode,
  viewStateReloading,
  viewsError,
  effectiveConfig,
  isCreateViewDialogOpen,
  nameDialogValue,
  nameDialogBusy,
  executionItems,
  executionsLoading,
  executionsError,
  selectedExecutionLogId,
  selectedExecution,
  selectedExecutionLog,
  inspectorLoading,
  inspectorError,
  innerPanelSizes,
  onInnerPanelLayout,
  onUpdateViewConfig,
  onToggleQuickFilter,
  isQuickFilterActive,
  onReorderColumnCards,
  onSelectExecution,
  onNavigatePrev,
  onNavigateNext,
  hasPrev,
  hasNext,
  onChangeNameDialogValue,
  onCloseNameDialog,
  onSubmitNameDialog,
  onReloadViews,
}: MonitorExecutionWorkspaceProps) {
  const isMobile = useIsMobile()
  const toolbarScrollRef = useRef<HTMLDivElement>(null)
  const controlsDisabled = viewStateMode !== 'server' || viewStateReloading
  const activeSort = effectiveConfig.sortBy[0] ?? null
  const secondarySort = effectiveConfig.sortBy[1] ?? null
  const boardSections = useMemo(
    () => buildMonitorBoardSections(executionItems, effectiveConfig),
    [effectiveConfig, executionItems]
  )
  const roadmapGroups = useMemo(
    () => buildMonitorRoadmapGroups(executionItems, effectiveConfig),
    [effectiveConfig, executionItems]
  )
  const columnOptions = useMemo(() => {
    const options = new Map<string, string>()

    executionItems.forEach((item) => {
      const value = getExecutionGroupValue(item, effectiveConfig.kanban.columnField)
      options.set(value.id, value.label)
    })

    return Array.from(options.entries()).map(([value, label]) => ({
      value,
      label,
    }))
  }, [effectiveConfig.kanban.columnField, executionItems])

  const resolvedInspectorLog = selectedExecutionLog ?? null
  const showDesktopInspector = !isMobile && Boolean(selectedExecution)

  const handleSortFieldChange = (field: MonitorSortField) => {
    onUpdateViewConfig((current) => ({
      ...current,
      sortBy: [
        {
          field,
          direction: current.sortBy[0]?.direction ?? getDefaultSortDirection(field),
        },
        ...current.sortBy.slice(1, 2).filter((entry) => entry.field !== field),
      ],
    }))
  }

  const handleSortDirectionChange = (direction: 'asc' | 'desc') => {
    if (!activeSort) return
    onUpdateViewConfig((current) => ({
      ...current,
      sortBy:
        current.sortBy.length === 0
          ? []
          : [{ ...current.sortBy[0]!, direction }, ...current.sortBy.slice(1, 2)],
    }))
  }

  const handleSecondarySortFieldChange = (field: MonitorSortField | '') => {
    onUpdateViewConfig((current) => {
      if (field === '') {
        return {
          ...current,
          sortBy: current.sortBy.slice(0, 1),
        }
      }

      const nextPrimary = current.sortBy[0]
      if (!nextPrimary) {
        return {
          ...current,
          sortBy: [{ field, direction: getDefaultSortDirection(field) }],
        }
      }

      return {
        ...current,
        sortBy: [
          nextPrimary,
          {
            field,
            direction: current.sortBy[1]?.direction ?? getDefaultSortDirection(field),
          },
        ],
      }
    })
  }

  const handleSecondarySortDirectionChange = (direction: 'asc' | 'desc') => {
    if (!secondarySort) return
    onUpdateViewConfig((current) => {
      const primary = current.sortBy[0]
      if (!primary || current.sortBy.length < 2) {
        return current
      }

      return {
        ...current,
        sortBy: [primary, { ...current.sortBy[1]!, direction }],
      }
    })
  }

  const handleFieldSumToggle = (fieldSum: MonitorFieldSum) => {
    onUpdateViewConfig((current) => ({
      ...current,
      fieldSums: current.fieldSums.includes(fieldSum)
        ? current.fieldSums.filter((value) => value !== fieldSum)
        : [...current.fieldSums, fieldSum],
    }))
  }

  const handleVisibleFieldToggle = (fieldId: (typeof MONITOR_VISIBLE_FIELDS)[number]) => {
    onUpdateViewConfig((current) => ({
      ...current,
      kanban: {
        ...current.kanban,
        visibleFieldIds: current.kanban.visibleFieldIds.includes(fieldId)
          ? current.kanban.visibleFieldIds.filter((value) => value !== fieldId)
          : [...current.kanban.visibleFieldIds, fieldId],
      },
    }))
  }

  const handleColumnVisibilityToggle = (columnId: string) => {
    onUpdateViewConfig((current) => ({
      ...current,
      kanban: {
        ...current.kanban,
        hiddenColumnIds: current.kanban.hiddenColumnIds.includes(columnId)
          ? current.kanban.hiddenColumnIds.filter((value) => value !== columnId)
          : [...current.kanban.hiddenColumnIds, columnId],
      },
    }))
  }

  const handleColumnLimitChange = (columnId: string, limit: number) => {
    onUpdateViewConfig((current) => {
      const nextLimits = { ...current.kanban.columnLimits }
      if (limit === 0) {
        delete nextLimits[columnId]
      } else {
        nextLimits[columnId] = limit
      }

      return {
        ...current,
        kanban: {
          ...current.kanban,
          columnLimits: nextLimits,
        },
      }
    })
  }

  const handleToolbarWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!toolbarScrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    toolbarScrollRef.current.scrollLeft += event.deltaY
  }, [])

  const handleTimelineScaleChange = (scale: number) => {
    onUpdateViewConfig((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        scale: Math.min(MONITOR_TIMELINE_SCALE_MAX, Math.max(MONITOR_TIMELINE_SCALE_MIN, scale)),
      },
    }))
  }

  const handleTimelineZoomChange = (zoom: MonitorTimelineZoom) => {
    onUpdateViewConfig((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        zoom,
      },
    }))
  }

  const handleTimelineMarkerToggle = (marker: keyof MonitorViewConfig['timeline']['markers']) => {
    onUpdateViewConfig((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        markers: {
          ...current.timeline.markers,
          [marker]: !current.timeline.markers[marker],
        },
      },
    }))
  }

  const handleTimezoneChange = (timezone: string) => {
    onUpdateViewConfig((current) => ({
      ...current,
      timezone,
    }))
  }

  const ActiveLayoutIcon = effectiveConfig.layout === 'kanban' ? SquareKanban : SquareChartGantt
  const activeLayoutLabel = effectiveConfig.layout === 'kanban' ? 'Kanban view' : 'Timeline view'

  const canvas = (
    <div className='flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden'>
      {effectiveConfig.layout === 'kanban' ? (
        <MonitorBoard
          sections={boardSections}
          selectedExecutionLogId={selectedExecutionLogId}
          visibleFieldIds={effectiveConfig.kanban.visibleFieldIds}
          timezone={effectiveConfig.timezone}
          canReorder={effectiveConfig.sortBy.length === 0}
          onSelectExecution={(logId) => onSelectExecution(logId)}
          onToggleQuickFilter={onToggleQuickFilter}
          isQuickFilterActive={isQuickFilterActive}
          onReorderColumnCards={onReorderColumnCards}
        />
      ) : (
        <MonitorRoadmap
          groups={roadmapGroups}
          config={effectiveConfig}
          selectedExecutionLogId={selectedExecutionLogId}
          controlsDisabled={controlsDisabled}
          onSelectExecution={(logId) => onSelectExecution(logId)}
          onTimelineZoomChange={handleTimelineZoomChange}
          onTimelineScaleChange={handleTimelineScaleChange}
        />
      )}
    </div>
  )

  const inspectorContent = selectedExecution ? (
    inspectorLoading && !resolvedInspectorLog ? (
      <div className='flex h-full items-center justify-center rounded-xl border bg-card/50'>
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <Loader2 className='h-4 w-4 animate-spin' />
          Loading execution details…
        </div>
      </div>
    ) : inspectorError ? (
      <InspectorState
        title='Execution details unavailable'
        description={inspectorError}
        actionLabel='Close inspector'
        onAction={() => onSelectExecution(null)}
      />
    ) : !resolvedInspectorLog ? (
      <InspectorState
        title='Execution details unavailable'
        description='The selected execution could not be loaded from the detail route.'
        actionLabel='Close inspector'
        onAction={() => onSelectExecution(null)}
      />
    ) : (
      <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card/50'>
        <ExecutionContextStrip execution={selectedExecution} />
        <div className='min-h-0 flex-1 overflow-hidden'>
          <LogDetails
            log={resolvedInspectorLog}
            isOpen
            onClose={() => onSelectExecution(null)}
            onNavigateNext={onNavigateNext}
            onNavigatePrev={onNavigatePrev}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
        </div>
      </div>
    )
  ) : null

  return (
    <div className='flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden p-1.5'>
      <div className='w-full bg-muted rounded-lg max-w-full min-w-0 shrink-0 overflow-hidden'>
        <div
          ref={toolbarScrollRef}
          onWheel={handleToolbarWheel}
          className='p-1.5 w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          <div
            role='toolbar'
            aria-label='Monitor view controls'
            className='flex w-max min-w-full items-center gap-2'
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='icon'
                  className='order-1 h-8 w-8 shrink-0 rounded-md'
                  disabled={controlsDisabled}
                  aria-label={`Select monitor layout. Current layout: ${activeLayoutLabel}.`}
                >
                  <ActiveLayoutIcon className='h-4 w-4' />
                  <span className='sr-only'>{activeLayoutLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start'>
                <DropdownMenuRadioGroup
                  value={effectiveConfig.layout}
                  onValueChange={(value) =>
                    onUpdateViewConfig((current) => ({
                      ...current,
                      layout: value as MonitorViewConfig['layout'],
                    }))
                  }
                >
                  <DropdownMenuRadioItem value='kanban'>
                    <SquareKanban className='mr-2 h-4 w-4' />
                    Kanban
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value='timeline'>
                    <SquareChartGantt className='mr-2 h-4 w-4' />
                    Timeline
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <MonitorTimezoneMenu
              timezone={effectiveConfig.timezone}
              disabled={controlsDisabled}
              className='order-2'
              onTimezoneChange={handleTimezoneChange}
            />

            <ToolbarMenu
              label='Sort by'
              className={effectiveConfig.layout === 'timeline' ? 'order-5' : 'order-3'}
              value={
                activeSort
                  ? [
                    `${SORT_FIELD_LABELS[activeSort.field]} ${activeSort.direction === 'asc' ? '↑' : '↓'}`,
                    ...(secondarySort
                      ? [
                        `${SORT_FIELD_LABELS[secondarySort.field]} ${secondarySort.direction === 'asc' ? '↑' : '↓'
                        }`,
                      ]
                      : []),
                  ].join(', ')
                  : 'Unsorted'
              }
              disabled={controlsDisabled}
            >
              <DropdownMenuItem
                onClick={() => onUpdateViewConfig((current) => ({ ...current, sortBy: [] }))}
              >
                Unsorted
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Field</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={activeSort?.field ?? ''}
                onValueChange={(value) => handleSortFieldChange(value as MonitorSortField)}
              >
                {MONITOR_SORT_FIELDS.map((field) => (
                  <DropdownMenuRadioItem key={field} value={field}>
                    {SORT_FIELD_LABELS[field]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Direction</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={activeSort?.direction ?? ''}
                onValueChange={(value) => handleSortDirectionChange(value as 'asc' | 'desc')}
              >
                <DropdownMenuRadioItem value='asc' disabled={!activeSort}>
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='desc' disabled={!activeSort}>
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Secondary field</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={secondarySort?.field ?? ''}
                onValueChange={(value) =>
                  handleSecondarySortFieldChange(value as MonitorSortField | '')
                }
              >
                <DropdownMenuRadioItem value=''>None</DropdownMenuRadioItem>
                {MONITOR_SORT_FIELDS.map((field) => (
                  <DropdownMenuRadioItem
                    key={`secondary:${field}`}
                    value={field}
                    disabled={activeSort?.field === field}
                  >
                    {SORT_FIELD_LABELS[field]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Secondary direction</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={secondarySort?.direction ?? ''}
                onValueChange={(value) =>
                  handleSecondarySortDirectionChange(value as 'asc' | 'desc')
                }
              >
                <DropdownMenuRadioItem value='asc' disabled={!secondarySort}>
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='desc' disabled={!secondarySort}>
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </ToolbarMenu>

            <ToolbarMenu
              label='Group by'
              className={effectiveConfig.layout === 'timeline' ? 'order-3' : 'order-4'}
              value={GROUP_FIELD_LABELS[effectiveConfig.groupBy]}
              disabled={controlsDisabled}
            >
              <DropdownMenuRadioGroup
                value={effectiveConfig.groupBy}
                onValueChange={(value) =>
                  onUpdateViewConfig((current) => ({
                    ...current,
                    groupBy: value as MonitorGroupField,
                  }))
                }
              >
                {MONITOR_GROUP_FIELDS.map((field) => (
                  <DropdownMenuRadioItem key={field} value={field}>
                    {GROUP_FIELD_LABELS[field]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </ToolbarMenu>

            <ToolbarMenu
              label='Slice by'
              className={effectiveConfig.layout === 'timeline' ? 'order-8' : 'order-5'}
              value={effectiveConfig.sliceBy ? GROUP_FIELD_LABELS[effectiveConfig.sliceBy] : 'None'}
              disabled={controlsDisabled}
            >
              <DropdownMenuRadioGroup
                value={effectiveConfig.sliceBy ?? ''}
                onValueChange={(value) =>
                  onUpdateViewConfig((current) => ({
                    ...current,
                    sliceBy: value ? (value as MonitorGroupField) : null,
                  }))
                }
              >
                <DropdownMenuRadioItem value=''>None</DropdownMenuRadioItem>
                {MONITOR_GROUP_FIELDS.map((field) => (
                  <DropdownMenuRadioItem key={field} value={field}>
                    {GROUP_FIELD_LABELS[field]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </ToolbarMenu>

            {effectiveConfig.layout === 'timeline' ? (
              <>
                <ToolbarMenu
                  label='Markers'
                  className='order-4'
                  value={getTimelineMarkersLabel(effectiveConfig.timeline.markers)}
                  disabled={controlsDisabled}
                >
                  <DropdownMenuCheckboxItem
                    checked={effectiveConfig.timeline.markers.today}
                    onCheckedChange={() => handleTimelineMarkerToggle('today')}
                  >
                    Today
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={effectiveConfig.timeline.markers.intervalBoundaries}
                    onCheckedChange={() => handleTimelineMarkerToggle('intervalBoundaries')}
                  >
                    Interval boundaries
                  </DropdownMenuCheckboxItem>
                </ToolbarMenu>

                <ToolbarMenu
                  label='Dates'
                  className='order-6'
                  value='Started → Ended'
                  disabled={controlsDisabled}
                >
                  <DropdownMenuLabel>Execution range</DropdownMenuLabel>
                  <DropdownMenuItem disabled>Started at → Ended at</DropdownMenuItem>
                </ToolbarMenu>

              </>
            ) : null}

            {effectiveConfig.layout === 'kanban' ? (
              <ToolbarMenu
                label='Swimlane'
                className='order-6'
                value={
                  effectiveConfig.verticalGroupBy
                    ? GROUP_FIELD_LABELS[effectiveConfig.verticalGroupBy]
                    : 'None'
                }
                disabled={controlsDisabled}
              >
                <DropdownMenuRadioGroup
                  value={effectiveConfig.verticalGroupBy ?? ''}
                  onValueChange={(value) =>
                    onUpdateViewConfig((current) => ({
                      ...current,
                      verticalGroupBy: value ? (value as MonitorGroupField) : null,
                    }))
                  }
                >
                  <DropdownMenuRadioItem value=''>None</DropdownMenuRadioItem>
                  {MONITOR_GROUP_FIELDS.map((field) => (
                    <DropdownMenuRadioItem key={field} value={field}>
                      {GROUP_FIELD_LABELS[field]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </ToolbarMenu>
            ) : null}

            <ToolbarMenu
              label='Field sum'
              className={effectiveConfig.layout === 'timeline' ? 'order-9' : 'order-7'}
              value={
                effectiveConfig.fieldSums.length > 0
                  ? effectiveConfig.fieldSums.map((field) => FIELD_SUM_LABELS[field]).join(', ')
                  : 'None'
              }
              disabled={controlsDisabled}
            >
              {MONITOR_FIELD_SUMS.map((fieldSum) => (
                <DropdownMenuCheckboxItem
                  key={fieldSum}
                  checked={effectiveConfig.fieldSums.includes(fieldSum)}
                  onCheckedChange={() => handleFieldSumToggle(fieldSum)}
                >
                  {FIELD_SUM_LABELS[fieldSum]}
                </DropdownMenuCheckboxItem>
              ))}
            </ToolbarMenu>

            {effectiveConfig.layout === 'kanban' ? (
              <>
                <ToolbarMenu
                  label='Column field'
                  className='order-8'
                  value={GROUP_FIELD_LABELS[effectiveConfig.kanban.columnField]}
                  disabled={controlsDisabled}
                >
                  <DropdownMenuRadioGroup
                    value={effectiveConfig.kanban.columnField}
                    onValueChange={(value) =>
                      onUpdateViewConfig((current) => ({
                        ...current,
                        kanban: {
                          ...current.kanban,
                          columnField: value as MonitorGroupField,
                          hiddenColumnIds: [],
                          localCardOrder: {},
                        },
                      }))
                    }
                  >
                    {MONITOR_GROUP_FIELDS.map((field) => (
                      <DropdownMenuRadioItem key={field} value={field}>
                        {GROUP_FIELD_LABELS[field]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </ToolbarMenu>

                <ToolbarMenu label='Fields' className='order-9' disabled={controlsDisabled}>
                  {MONITOR_VISIBLE_FIELDS.map((fieldId) => (
                    <DropdownMenuCheckboxItem
                      key={fieldId}
                      checked={effectiveConfig.kanban.visibleFieldIds.includes(fieldId)}
                      onCheckedChange={() => handleVisibleFieldToggle(fieldId)}
                    >
                      {VISIBLE_FIELD_LABELS[fieldId]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </ToolbarMenu>

                <ToolbarMenu
                  label='Columns'
                  className='order-10'
                  disabled={controlsDisabled || columnOptions.length === 0}
                >
                  {columnOptions.length === 0 ? (
                    <DropdownMenuItem disabled>No columns</DropdownMenuItem>
                  ) : (
                    columnOptions.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={!effectiveConfig.kanban.hiddenColumnIds.includes(option.value)}
                        onCheckedChange={() => handleColumnVisibilityToggle(option.value)}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))
                  )}
                </ToolbarMenu>

                <ToolbarMenu
                  label='Column limits'
                  className='order-11'
                  disabled={controlsDisabled || columnOptions.length === 0}
                >
                  {columnOptions.length === 0 ? (
                    <DropdownMenuItem disabled>No columns</DropdownMenuItem>
                  ) : (
                    columnOptions.map((option) => (
                      <DropdownMenuSub key={option.value}>
                        <DropdownMenuSubTrigger>{option.label}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuRadioGroup
                            value={String(effectiveConfig.kanban.columnLimits[option.value] ?? 0)}
                            onValueChange={(value) =>
                              handleColumnLimitChange(option.value, Number.parseInt(value, 10))
                            }
                          >
                            {DEFAULT_COLUMN_LIMITS.map((limit) => (
                              <DropdownMenuRadioItem key={limit} value={String(limit)}>
                                {limit === 0 ? 'No limit' : `${limit} items`}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))
                  )}
                </ToolbarMenu>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className='flex min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden pt-1.5'>
        {viewStateMode === 'loading' ? (
          <div className='flex min-h-[320px] flex-1 items-center justify-center rounded-xl border bg-card/40'>
            <div className='flex items-center gap-2 text-muted-foreground text-sm'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Loading monitor views…
            </div>
          </div>
        ) : viewStateMode === 'error' ? (
          <div className='flex min-h-[320px] flex-1 items-center justify-center rounded-xl border bg-card/40 p-6'>
            <div className='flex max-w-md flex-col items-center gap-3 text-center'>
              <div className='font-medium text-base'>Views unavailable</div>
              <p className='text-muted-foreground text-sm'>
                {viewsError ?? 'Monitor views could not be loaded right now.'}
              </p>
              <Button
                variant='outline'
                size='sm'
                onClick={onReloadViews}
                disabled={viewStateReloading}
              >
                {viewStateReloading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
                Reload views
              </Button>
            </div>
          </div>
        ) : (
          <>
            {viewsError ? (
              <div className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 text-sm'>
                {viewsError}
              </div>
            ) : null}
            {executionsError ? (
              <div className='mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
                {executionsError}
              </div>
            ) : null}
            {executionsLoading ? (
              <div className='flex min-h-[320px] flex-1 items-center justify-center rounded-xl border bg-card/40'>
                <div className='flex items-center gap-2 text-muted-foreground text-sm'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Loading executions…
                </div>
              </div>
            ) : showDesktopInspector && inspectorContent ? (
              <ResizablePanelGroup
                direction='horizontal'
                className='flex min-h-0 w-full max-w-full min-w-0 flex-1 overflow-hidden'
                onLayout={onInnerPanelLayout}
              >
                <ResizablePanel
                  order={1}
                  defaultSize={innerPanelSizes?.[0] ?? 68}
                  minSize={45}
                  className='flex h-full max-h-full w-full max-w-full min-h-0 min-w-0 flex-col overflow-hidden'
                >
                  {canvas}
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel
                  order={2}
                  defaultSize={innerPanelSizes?.[1] ?? 32}
                  minSize={24}
                  className='min-h-0 min-w-0 overflow-auto'
                >
                  {inspectorContent}
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              canvas
            )}
          </>
        )}
      </div>

      <Sheet
        open={Boolean(isMobile && selectedExecution)}
        onOpenChange={(open) => !open && onSelectExecution(null)}
      >
        <SheetContent side='right' className='w-full p-3 sm:max-w-[640px]'>
          <div className='flex h-full min-h-0 flex-col overflow-hidden pt-6'>
            {inspectorContent}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={isCreateViewDialogOpen} onOpenChange={(open) => !open && onCloseNameDialog()}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Create View</DialogTitle>
            <DialogDescription>
              Create a new saved view from the current execution workspace settings.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameDialogValue}
            onChange={(event) => onChangeNameDialogValue(event.target.value)}
            placeholder='View name'
            disabled={nameDialogBusy}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSubmitNameDialog()
              }
            }}
          />
          <DialogFooter>
            <Button variant='outline' onClick={onCloseNameDialog} disabled={nameDialogBusy}>
              Cancel
            </Button>
            <Button
              onClick={onSubmitNameDialog}
              disabled={nameDialogBusy || !nameDialogValue.trim()}
            >
              {nameDialogBusy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
              Create view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
