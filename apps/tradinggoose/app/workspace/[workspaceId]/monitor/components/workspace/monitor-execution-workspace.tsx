'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Notice } from '@/components/ui/notice'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { LogDetails } from '@/app/workspace/[workspaceId]/records/components/log-details/log-details'
import { useIsMobile } from '@/hooks/use-mobile'
import { buildMonitorBoardSections } from '../board/board-state'
import { MonitorBoard } from '../board/monitor-board'
import { getExecutionGroupValue, type MonitorExecutionItem } from '../data/execution-ordering'
import {
  MonitorControlBar,
  MonitorControlSelect,
  MonitorControlToggle,
  MonitorStateCard,
} from '../shared/monitor-ui'
import { MonitorTimeline } from '../timeline/monitor-timeline'
import { buildMonitorTimelineGroups } from '../timeline/timeline-state'
import { MonitorTimezoneMenu } from '../timezone-selector/monitor-timezone-menu'
import {
  DEFAULT_EXECUTION_PANEL_SIZES,
  EXECUTION_MONITOR_FIELD_SUMS,
  EXECUTION_MONITOR_GROUP_FIELDS,
  EXECUTION_MONITOR_SORT_FIELDS,
  EXECUTION_MONITOR_VISIBLE_FIELDS,
  type ExecutionMonitorFieldSum,
  type ExecutionMonitorGroupField,
  type ExecutionMonitorQuickFilterField,
  type ExecutionMonitorSortField,
  type ExecutionMonitorTimelineZoom,
  type ExecutionMonitorViewConfig,
  MONITOR_TIMELINE_SCALE_MAX,
  MONITOR_TIMELINE_SCALE_MIN,
} from '../view/view-config'

type MonitorExecutionWorkspaceProps = {
  viewStateMode: 'loading' | 'server' | 'error'
  viewStateReloading: boolean
  viewsError: string | null
  effectiveConfig: ExecutionMonitorViewConfig
  executionItems: MonitorExecutionItem[]
  executionsLoading: boolean
  executionsError: string | null
  selectedExecutionLogId: string | null
  selectedExecution: MonitorExecutionItem | null
  selectedExecutionLog: MonitorExecutionItem['sourceLog'] | null
  inspectorLoading: boolean
  inspectorError: string | null
  panelSizes: [number, number] | null
  onPanelLayout: (sizes: number[]) => void
  onUpdateViewConfig: (
    next:
      | ExecutionMonitorViewConfig
      | ((current: ExecutionMonitorViewConfig) => ExecutionMonitorViewConfig)
  ) => void
  onToggleQuickFilter: (field: ExecutionMonitorQuickFilterField, value: string) => void
  isQuickFilterActive: (field: ExecutionMonitorQuickFilterField, value: string) => boolean
  onReorderColumnCards: (columnId: string, nextExecutionIds: string[]) => void
  onSelectExecution: (logId: string | null) => void
  onNavigatePrev: () => void
  onNavigateNext: () => void
  hasPrev: boolean
  hasNext: boolean
  onReloadViews: () => void
}

const GROUP_FIELD_LABELS: Record<ExecutionMonitorGroupField, string> = {
  outcome: 'Outcome',
  workflow: 'Workflow',
  trigger: 'Trigger',
  listing: 'Listing',
  assetType: 'Asset type',
  provider: 'Provider',
  interval: 'Interval',
  monitor: 'Monitor',
}

const SORT_FIELD_LABELS: Record<ExecutionMonitorSortField, string> = {
  startedAt: 'Started at',
  endedAt: 'Ended at',
  durationMs: 'Duration',
  cost: 'Cost',
  workflowName: 'Workflow',
  providerId: 'Provider',
  interval: 'Interval',
  listingLabel: 'Listing',
}

const FIELD_SUM_LABELS: Record<ExecutionMonitorFieldSum, string> = {
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

const getDefaultSortDirection = (field: ExecutionMonitorSortField) => {
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

function ExecutionContextStrip({ execution }: { execution: MonitorExecutionItem }) {
  return (
    <div className='border-b bg-muted/30 px-3 py-3'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='font-medium text-foreground'>{execution.workflowName}</span>
        <Badge variant='secondary'>{execution.outcome}</Badge>
        {execution.monitorId ? <Badge variant='outline'>{execution.monitorId}</Badge> : null}
        {execution.providerId ? <Badge variant='outline'>{execution.providerId}</Badge> : null}
        {execution.interval ? <Badge variant='outline'>{execution.interval}</Badge> : null}
        {execution.isOrphaned ? (
          <Badge variant='destructive'>Source monitor unavailable</Badge>
        ) : null}
        {execution.isPartial ? (
          <Badge variant='outline' className='border-amber-500/30 bg-amber-500/10 text-amber-700'>
            Snapshot incomplete
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

export function MonitorExecutionWorkspace({
  viewStateMode,
  viewStateReloading,
  viewsError,
  effectiveConfig,
  executionItems,
  executionsLoading,
  executionsError,
  selectedExecutionLogId,
  selectedExecution,
  selectedExecutionLog,
  inspectorLoading,
  inspectorError,
  panelSizes,
  onPanelLayout,
  onUpdateViewConfig,
  onToggleQuickFilter,
  isQuickFilterActive,
  onReorderColumnCards,
  onSelectExecution,
  onNavigatePrev,
  onNavigateNext,
  hasPrev,
  hasNext,
  onReloadViews,
}: MonitorExecutionWorkspaceProps) {
  const isMobile = useIsMobile()
  const controlsDisabled = viewStateMode !== 'server' || viewStateReloading
  const activeSort = effectiveConfig.sortBy[0] ?? null
  const secondarySort = effectiveConfig.sortBy[1] ?? null
  const boardSections = useMemo(
    () => buildMonitorBoardSections(executionItems, effectiveConfig),
    [effectiveConfig, executionItems]
  )
  const timelineGroups = useMemo(
    () => buildMonitorTimelineGroups(executionItems, effectiveConfig),
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

  const handleSortFieldChange = (field: ExecutionMonitorSortField) => {
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

  const handleSecondarySortFieldChange = (field: ExecutionMonitorSortField | '') => {
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

  const handleFieldSumToggle = (fieldSum: ExecutionMonitorFieldSum) => {
    onUpdateViewConfig((current) => ({
      ...current,
      fieldSums: current.fieldSums.includes(fieldSum)
        ? current.fieldSums.filter((value) => value !== fieldSum)
        : [...current.fieldSums, fieldSum],
    }))
  }

  const handleVisibleFieldToggle = (fieldId: (typeof EXECUTION_MONITOR_VISIBLE_FIELDS)[number]) => {
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

  const handleTimelineScaleChange = (scale: number) => {
    onUpdateViewConfig((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        scale: Math.min(MONITOR_TIMELINE_SCALE_MAX, Math.max(MONITOR_TIMELINE_SCALE_MIN, scale)),
      },
    }))
  }

  const handleTimelineZoomChange = (zoom: ExecutionMonitorTimelineZoom) => {
    onUpdateViewConfig((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        zoom,
      },
    }))
  }

  const handleTimelineMarkerToggle = (
    marker: keyof ExecutionMonitorViewConfig['timeline']['markers']
  ) => {
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

  const canvas = (
    <div className='flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden'>
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
        <MonitorTimeline
          groups={timelineGroups}
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
      <MonitorStateCard loadingLabel='Loading execution details…' className='h-full bg-card/50' />
    ) : inspectorError ? (
      <MonitorStateCard
        title='Execution details unavailable'
        description={inspectorError}
        actionLabel='Close inspector'
        onAction={() => onSelectExecution(null)}
      />
    ) : !resolvedInspectorLog ? (
      <MonitorStateCard
        title='Execution details unavailable'
        description='The selected execution could not be loaded from the detail route.'
        actionLabel='Close inspector'
        onAction={() => onSelectExecution(null)}
      />
    ) : (
      <Card className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card/50'>
        <ExecutionContextStrip execution={selectedExecution} />
        <CardContent className='min-h-0 flex-1 overflow-hidden p-0'>
          <LogDetails
            log={resolvedInspectorLog}
            isOpen
            onClose={() => onSelectExecution(null)}
            onNavigateNext={onNavigateNext}
            onNavigatePrev={onNavigatePrev}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
        </CardContent>
      </Card>
    )
  ) : null

  return (
    <div className='flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden p-1.5'>
      <MonitorControlBar toolbarLabel='Monitor view controls'>
        <MonitorControlSelect
          value={effectiveConfig.layout}
          disabled={controlsDisabled}
          triggerClassName='w-[150px]'
          options={[
            { value: 'kanban', label: 'Layout: Kanban' },
            { value: 'timeline', label: 'Layout: Timeline' },
          ]}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              layout: value as ExecutionMonitorViewConfig['layout'],
            }))
          }
        />

        <MonitorTimezoneMenu
          timezone={effectiveConfig.timezone}
          disabled={controlsDisabled}
          onTimezoneChange={handleTimezoneChange}
        />

        <MonitorControlSelect
          value={activeSort?.field ?? 'manual'}
          disabled={controlsDisabled}
          triggerClassName='w-[185px]'
          options={[
            { value: 'manual', label: 'Manual order' },
            ...EXECUTION_MONITOR_SORT_FIELDS.map((field) => ({
              value: field,
              label: `Sort by: ${SORT_FIELD_LABELS[field]}`,
            })),
          ]}
          onValueChange={(value) =>
            value === 'manual'
              ? onUpdateViewConfig((current) => ({ ...current, sortBy: [] }))
              : handleSortFieldChange(value as ExecutionMonitorSortField)
          }
        />

        <MonitorControlSelect
          value={activeSort?.direction ?? 'desc'}
          disabled={controlsDisabled || !activeSort}
          triggerClassName='w-[155px]'
          options={[
            { value: 'asc', label: 'Direction: Asc' },
            { value: 'desc', label: 'Direction: Desc' },
          ]}
          onValueChange={(value) => handleSortDirectionChange(value as 'asc' | 'desc')}
        />

        <MonitorControlSelect
          value={secondarySort?.field ?? 'none'}
          disabled={controlsDisabled}
          triggerClassName='w-[195px]'
          options={[
            { value: 'none', label: 'No secondary sort' },
            ...EXECUTION_MONITOR_SORT_FIELDS.map((field) => ({
              value: field,
              label: `Then: ${SORT_FIELD_LABELS[field]}`,
              disabled: activeSort?.field === field,
            })),
          ]}
          onValueChange={(value) =>
            handleSecondarySortFieldChange(
              value === 'none' ? '' : (value as ExecutionMonitorSortField)
            )
          }
        />

        <MonitorControlSelect
          value={secondarySort?.direction ?? 'asc'}
          disabled={controlsDisabled || !secondarySort}
          triggerClassName='w-[155px]'
          options={[
            { value: 'asc', label: 'Then dir: Asc' },
            { value: 'desc', label: 'Then dir: Desc' },
          ]}
          onValueChange={(value) => handleSecondarySortDirectionChange(value as 'asc' | 'desc')}
        />

        <MonitorControlSelect
          value={effectiveConfig.groupBy}
          disabled={controlsDisabled}
          triggerClassName='w-[170px]'
          options={EXECUTION_MONITOR_GROUP_FIELDS.map((field) => ({
            value: field,
            label: `Group: ${GROUP_FIELD_LABELS[field]}`,
          }))}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              groupBy: value as ExecutionMonitorGroupField,
            }))
          }
        />

        <MonitorControlSelect
          value={effectiveConfig.sliceBy ?? 'none'}
          disabled={controlsDisabled}
          triggerClassName='w-[170px]'
          options={[
            { value: 'none', label: 'No slice' },
            ...EXECUTION_MONITOR_GROUP_FIELDS.filter(
              (field) => field !== effectiveConfig.groupBy
            ).map((field) => ({
              value: field,
              label: `Slice: ${GROUP_FIELD_LABELS[field]}`,
            })),
          ]}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              sliceBy: value === 'none' ? null : (value as ExecutionMonitorGroupField),
            }))
          }
        />

        {effectiveConfig.layout === 'timeline' ? (
          <>
            <MonitorControlToggle
              pressed={effectiveConfig.timeline.markers.today}
              disabled={controlsDisabled}
              onClick={() => handleTimelineMarkerToggle('today')}
            >
              Today
            </MonitorControlToggle>
            <MonitorControlToggle
              pressed={effectiveConfig.timeline.markers.intervalBoundaries}
              disabled={controlsDisabled}
              onClick={() => handleTimelineMarkerToggle('intervalBoundaries')}
            >
              Boundaries
            </MonitorControlToggle>
            <Button type='button' variant='outline' size='sm' className='h-8 shrink-0' disabled>
              Dates: Started → Ended
            </Button>
          </>
        ) : null}

        {effectiveConfig.layout === 'kanban' ? (
          <MonitorControlSelect
            value={effectiveConfig.verticalGroupBy ?? 'none'}
            disabled={controlsDisabled}
            triggerClassName='w-[185px]'
            options={[
              { value: 'none', label: 'No swimlane' },
              ...EXECUTION_MONITOR_GROUP_FIELDS.filter(
                (field) => field !== effectiveConfig.groupBy && field !== effectiveConfig.sliceBy
              ).map((field) => ({
                value: field,
                label: `Swimlane: ${GROUP_FIELD_LABELS[field]}`,
              })),
            ]}
            onValueChange={(value) =>
              onUpdateViewConfig((current) => ({
                ...current,
                verticalGroupBy: value === 'none' ? null : (value as ExecutionMonitorGroupField),
              }))
            }
          />
        ) : null}

        {EXECUTION_MONITOR_FIELD_SUMS.map((fieldSum) => (
          <MonitorControlToggle
            key={fieldSum}
            pressed={effectiveConfig.fieldSums.includes(fieldSum)}
            disabled={controlsDisabled}
            onClick={() => handleFieldSumToggle(fieldSum)}
          >
            {FIELD_SUM_LABELS[fieldSum]}
          </MonitorControlToggle>
        ))}

        {effectiveConfig.layout === 'kanban' ? (
          <MonitorControlSelect
            value={effectiveConfig.kanban.columnField}
            disabled={controlsDisabled}
            triggerClassName='w-[185px]'
            options={EXECUTION_MONITOR_GROUP_FIELDS.map((field) => ({
              value: field,
              label: `Column: ${GROUP_FIELD_LABELS[field]}`,
            }))}
            onValueChange={(value) =>
              onUpdateViewConfig((current) => ({
                ...current,
                kanban: {
                  ...current.kanban,
                  columnField: value as ExecutionMonitorGroupField,
                  hiddenColumnIds: [],
                  localCardOrder: {},
                },
              }))
            }
          />
        ) : null}

        {effectiveConfig.layout === 'kanban'
          ? EXECUTION_MONITOR_VISIBLE_FIELDS.map((fieldId) => (
              <MonitorControlToggle
                key={fieldId}
                pressed={effectiveConfig.kanban.visibleFieldIds.includes(fieldId)}
                disabled={controlsDisabled}
                onClick={() => handleVisibleFieldToggle(fieldId)}
              >
                {VISIBLE_FIELD_LABELS[fieldId]}
              </MonitorControlToggle>
            ))
          : null}

        {effectiveConfig.layout === 'kanban' && columnOptions.length === 0 ? (
          <Button type='button' variant='outline' size='sm' className='h-8 shrink-0' disabled>
            No columns
          </Button>
        ) : null}

        {effectiveConfig.layout === 'kanban'
          ? columnOptions.map((option) => {
              const visible = !effectiveConfig.kanban.hiddenColumnIds.includes(option.value)

              return (
                <MonitorControlToggle
                  key={option.value}
                  pressed={visible}
                  disabled={controlsDisabled}
                  onClick={() => handleColumnVisibilityToggle(option.value)}
                >
                  {option.label}
                </MonitorControlToggle>
              )
            })
          : null}

        {effectiveConfig.layout === 'kanban'
          ? columnOptions.map((option) => (
              <MonitorControlSelect
                key={`limit:${option.value}`}
                value={String(effectiveConfig.kanban.columnLimits[option.value] ?? 0)}
                disabled={controlsDisabled}
                triggerClassName='w-[185px]'
                options={DEFAULT_COLUMN_LIMITS.map((limit) => ({
                  value: String(limit),
                  label: `${option.label}: ${limit === 0 ? 'No limit' : `${limit} items`}`,
                }))}
                onValueChange={(value) =>
                  handleColumnLimitChange(option.value, Number.parseInt(value, 10))
                }
              />
            ))
          : null}
      </MonitorControlBar>

      <div className='flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden pt-1.5'>
        {viewStateMode === 'loading' ? (
          <MonitorStateCard
            loadingLabel='Loading monitor views…'
            className='min-h-[320px] flex-1'
          />
        ) : viewStateMode === 'error' ? (
          <MonitorStateCard
            title='Views unavailable'
            description={viewsError ?? 'Monitor views could not be loaded right now.'}
            actionLabel={
              viewStateReloading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Reload views
                </>
              ) : (
                'Reload views'
              )
            }
            actionDisabled={viewStateReloading}
            onAction={onReloadViews}
            className='min-h-[320px] flex-1'
          />
        ) : (
          <>
            {viewsError ? (
              <Notice variant='warning' className='mb-3'>
                {viewsError}
              </Notice>
            ) : null}
            {executionsError ? (
              <Notice variant='error' className='mb-3'>
                {executionsError}
              </Notice>
            ) : null}
            {executionsLoading ? (
              <MonitorStateCard
                loadingLabel='Loading executions…'
                className='min-h-[320px] flex-1'
              />
            ) : showDesktopInspector && inspectorContent ? (
              <ResizablePanelGroup
                direction='horizontal'
                className='flex min-h-0 w-full min-w-0 max-w-full flex-1 overflow-hidden'
                onLayout={onPanelLayout}
              >
                <ResizablePanel
                  order={1}
                  defaultSize={panelSizes?.[0] ?? DEFAULT_EXECUTION_PANEL_SIZES[0]}
                  minSize={45}
                  className='flex h-full max-h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden'
                >
                  {canvas}
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel
                  order={2}
                  defaultSize={panelSizes?.[1] ?? DEFAULT_EXECUTION_PANEL_SIZES[1]}
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
    </div>
  )
}
