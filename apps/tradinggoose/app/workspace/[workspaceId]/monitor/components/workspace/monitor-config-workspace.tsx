'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { Notice } from '@/components/ui/notice'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useIsMobile } from '@/hooks/use-mobile'
import { buildConfigBoardSections, type ConfigBoardContext } from '../config/config-board-state'
import { buildConfigMonitorCards } from '../config/config-card-model'
import {
  buildDraftFromMonitorWithPatch,
  buildMonitorUpdatePayloadFromDraft,
  buildOptimisticMonitorRecordFromDraft,
  validateMonitorDraft,
} from '../config/config-draft'
import { resolveConfigBoardContextPatch } from '../config/config-drop'
import { filterConfigMonitorCards } from '../config/config-filter'
import { MonitorConfigBoard } from '../config/monitor-config-board'
import { useMonitorExecutionSummaries } from '../data/use-monitor-execution-summaries'
import { MonitorEditorPanel } from '../management/monitor-editor-panel'
import { useMonitorEditorState } from '../management/use-monitor-editor-state'
import {
  MonitorControlBar,
  MonitorControlMenu,
  MonitorControlSelect,
  MonitorStateCard,
} from '../shared/monitor-ui'
import type {
  IndicatorMonitorRecord,
  MonitorRecordActions,
  MonitorReferenceData,
} from '../shared/types'
import { MonitorTimezoneMenu } from '../timezone-selector/monitor-timezone-menu'
import {
  CONFIG_MONITOR_DIMENSION_FIELDS,
  CONFIG_MONITOR_FIELD_SUMS,
  CONFIG_MONITOR_SORT_FIELDS,
  CONFIG_MONITOR_VISIBLE_FIELDS,
  type ConfigMonitorDimensionField,
  type ConfigMonitorFieldSum,
  type ConfigMonitorSortField,
  type ConfigMonitorViewConfig,
  type ConfigMonitorVisibleField,
  DEFAULT_CONFIG_PANEL_SIZES,
} from '../view/view-config'

type MonitorConfigWorkspaceProps = {
  workspaceId: string
  viewStateMode: 'loading' | 'server' | 'error'
  viewStateReloading: boolean
  viewsError: string | null
  effectiveConfig: ConfigMonitorViewConfig
  panelSizes: [number, number] | null
  monitorRecords: IndicatorMonitorRecord[]
  monitorsLoading: boolean
  monitorsError: string | null
  referenceData: MonitorReferenceData
  monitorActions: MonitorRecordActions
  createMonitorRequestId: number
  onPanelLayout: (sizes: number[]) => void
  onUpdateViewConfig: (
    next: ConfigMonitorViewConfig | ((current: ConfigMonitorViewConfig) => ConfigMonitorViewConfig)
  ) => void
  onReloadViews: () => void
}

const DIMENSION_LABELS: Record<ConfigMonitorDimensionField, string> = {
  workflowTarget: 'Workflow target',
  indicator: 'Indicator',
  listing: 'Listing',
  provider: 'Provider',
  interval: 'Interval',
}

const SORT_LABELS: Record<ConfigMonitorSortField, string> = {
  createdAt: 'Created',
  updatedAt: 'Updated',
  workflowTargetLabel: 'Workflow target',
  indicatorName: 'Indicator',
  listingLabel: 'Listing',
  providerId: 'Provider',
  interval: 'Interval',
  status: 'Status',
  lastExecutionAt: 'Last execution',
  lastOutcome: 'Last outcome',
}

const VISIBLE_LABELS: Record<ConfigMonitorVisibleField, string> = {
  workflowTarget: 'Workflow target',
  indicator: 'Indicator',
  listing: 'Listing',
  provider: 'Provider',
  interval: 'Interval',
  status: 'Status',
  createdAt: 'Created',
  updatedAt: 'Updated',
  lastExecutionAt: 'Last execution',
  lastOutcome: 'Last outcome',
}

const FIELD_SUM_LABELS: Record<ConfigMonitorFieldSum, string> = {
  count: 'Count',
  activeCount: 'Active',
  pausedCount: 'Paused',
}

const summarizeConfigFieldSums = (fieldSums: ConfigMonitorFieldSum[]) => {
  if (fieldSums.length === 0) return 'None'
  if (fieldSums.length === 1) return FIELD_SUM_LABELS[fieldSums[0]!]
  return `${FIELD_SUM_LABELS[fieldSums[0]!]} +${fieldSums.length - 1}`
}

const summarizeConfigVisibleFields = (
  visibleFieldIds: ConfigMonitorViewConfig['kanban']['visibleFieldIds']
) => `${visibleFieldIds.length} shown`

export function MonitorConfigWorkspace({
  workspaceId,
  viewStateMode,
  viewStateReloading,
  viewsError,
  effectiveConfig,
  panelSizes,
  monitorRecords,
  monitorsLoading,
  monitorsError,
  referenceData,
  monitorActions,
  createMonitorRequestId,
  onPanelLayout,
  onUpdateViewConfig,
  onReloadViews,
}: MonitorConfigWorkspaceProps) {
  const isMobile = useIsMobile()
  const lastHandledCreateMonitorRequestIdRef = useRef(0)
  const targetMonitorIds = useMemo(
    () => Array.from(new Set(monitorRecords.map((monitor) => monitor.monitorId))).sort(),
    [monitorRecords]
  )
  const summaries = useMonitorExecutionSummaries({
    workspaceId,
    targetMonitorIds,
    enabled: viewStateMode === 'server' && targetMonitorIds.length > 0,
  })
  const cards = useMemo(
    () => buildConfigMonitorCards(monitorRecords, referenceData, summaries.summariesByMonitorId),
    [monitorRecords, referenceData, summaries.summariesByMonitorId]
  )
  const filteredCards = useMemo(
    () => filterConfigMonitorCards(cards, effectiveConfig),
    [cards, effectiveConfig]
  )
  const sections = useMemo(
    () => buildConfigBoardSections(filteredCards, effectiveConfig, referenceData),
    [effectiveConfig, filteredCards, referenceData]
  )
  const cardById = useMemo(() => new Map(cards.map((card) => [card.monitorId, card])), [cards])
  const wrappedMonitorActions = useMemo<MonitorRecordActions>(
    () => ({
      createMonitor: async (input) => {
        const result = await monitorActions.createMonitor(input)
        void summaries.refresh()
        return result
      },
      updateMonitor: async (monitorId, input, options) => {
        const result = await monitorActions.updateMonitor(monitorId, input, options)
        void summaries.refresh()
        return result
      },
      toggleMonitorState: async (monitor, nextIsActive, options) => {
        const result = await monitorActions.toggleMonitorState(monitor, nextIsActive, options)
        void summaries.refresh()
        return result
      },
      deleteMonitor: async (monitorId) => {
        await monitorActions.deleteMonitor(monitorId)
        void summaries.refresh()
      },
    }),
    [monitorActions, summaries]
  )
  const editorState = useMonitorEditorState({
    workspaceId,
    monitorRecords,
    referenceData,
    monitorActions: wrappedMonitorActions,
    viewConfig: effectiveConfig,
  })
  const controlsDisabled =
    viewStateMode !== 'server' || viewStateReloading || referenceData.isLoading

  useEffect(() => {
    if (viewStateMode !== 'server') return
    if (controlsDisabled || referenceData.createDisabledReason) return
    if (createMonitorRequestId === lastHandledCreateMonitorRequestIdRef.current) return

    lastHandledCreateMonitorRequestIdRef.current = createMonitorRequestId
    editorState.openCreate()
  }, [
    controlsDisabled,
    createMonitorRequestId,
    editorState,
    referenceData.createDisabledReason,
    viewStateMode,
  ])

  const activeSort = effectiveConfig.sortBy[0] ?? null
  const canReorder = effectiveConfig.sortBy.length === 0
  const noticeMessage = viewsError ?? referenceData.warning ?? monitorsError ?? summaries.error

  const handleFieldSumToggle = (field: ConfigMonitorFieldSum) => {
    onUpdateViewConfig((current) => ({
      ...current,
      fieldSums: current.fieldSums.includes(field)
        ? current.fieldSums.filter((value) => value !== field)
        : current.fieldSums.concat(field),
    }))
  }

  const handleVisibleFieldToggle = (field: ConfigMonitorVisibleField) => {
    onUpdateViewConfig((current) => ({
      ...current,
      kanban: {
        ...current.kanban,
        visibleFieldIds: current.kanban.visibleFieldIds.includes(field)
          ? current.kanban.visibleFieldIds.filter((value) => value !== field)
          : current.kanban.visibleFieldIds.concat(field),
      },
    }))
  }

  const handleReorderBucketCards = (bucketId: string, nextMonitorIds: string[]) => {
    onUpdateViewConfig((current) => ({
      ...current,
      kanban: {
        ...current.kanban,
        localCardOrder: {
          ...current.kanban.localCardOrder,
          [bucketId]: nextMonitorIds,
        },
      },
    }))
  }

  const handleMoveCard = useCallback(
    async (monitorId: string, targetContext: ConfigBoardContext) => {
      const card = cardById.get(monitorId)
      if (!card) return

      const resolution = resolveConfigBoardContextPatch({
        decodedContext: targetContext,
        viewConfig: effectiveConfig,
        referenceData,
        sourceCard: card,
      })
      if (Object.keys(resolution.errors).length > 0) {
        editorState.openRejectedDropProposal(card.sourceMonitor, {
          draftPatch: resolution.draftPatch,
          errors: resolution.errors,
        })
        return
      }

      const draft = buildDraftFromMonitorWithPatch(
        card.sourceMonitor,
        resolution.draftPatch,
        referenceData
      )
      const validation = validateMonitorDraft({ draft, referenceData })
      if (!validation.valid) {
        editorState.openRejectedDropProposal(card.sourceMonitor, {
          draftPatch: resolution.draftPatch,
          errors: validation.errors,
        })
        return
      }

      const optimisticRecord = buildOptimisticMonitorRecordFromDraft(card.sourceMonitor, draft)
      if (
        resolution.updatePatch.isActive !== undefined &&
        Object.keys(resolution.updatePatch).length === 1
      ) {
        await wrappedMonitorActions.toggleMonitorState(
          card.sourceMonitor,
          resolution.updatePatch.isActive,
          { optimisticRecord }
        )
        return
      }

      await wrappedMonitorActions.updateMonitor(
        monitorId,
        buildMonitorUpdatePayloadFromDraft({
          workspaceId,
          draft,
          originalMonitor: card.sourceMonitor,
          referenceData,
        }),
        { optimisticRecord }
      )
    },
    [cardById, editorState, effectiveConfig, referenceData, workspaceId, wrappedMonitorActions]
  )

  if (viewStateMode === 'loading' || referenceData.isLoading) {
    return (
      <MonitorStateCard
        loadingLabel={
          viewStateMode === 'loading'
            ? 'Loading config views...'
            : 'Loading monitor requirements...'
        }
        className='h-full w-full border-0 bg-transparent'
      />
    )
  }

  if (viewStateMode === 'error') {
    return (
      <MonitorStateCard
        title='Config views unavailable'
        description={viewsError ?? 'Unable to load config monitor views.'}
        actionLabel='Retry'
        onAction={onReloadViews}
        className='h-full w-full border-0 bg-transparent'
      />
    )
  }

  const board = (
    <div className='flex h-full min-h-0 flex-col gap-2 px-1.5'>
      <MonitorControlBar toolbarLabel='Monitor config controls'>
        <MonitorTimezoneMenu
          timezone={effectiveConfig.timezone}
          disabled={controlsDisabled}
          onTimezoneChange={(timezone) =>
            onUpdateViewConfig((current) => ({
              ...current,
              timezone,
            }))
          }
        />
        <MonitorControlSelect
          value={effectiveConfig.groupBy}
          label='Group'
          disabled={controlsDisabled}
          triggerClassName='w-[140px]'
          options={CONFIG_MONITOR_DIMENSION_FIELDS.map((field) => ({
            value: field,
            label: DIMENSION_LABELS[field],
          }))}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              groupBy: value as ConfigMonitorDimensionField,
            }))
          }
        />
        <MonitorControlSelect
          value={effectiveConfig.sliceBy ?? 'none'}
          label='Slice'
          disabled={controlsDisabled}
          triggerClassName='w-[140px]'
          options={[
            { value: 'none', label: 'None' },
            ...CONFIG_MONITOR_DIMENSION_FIELDS.filter(
              (field) => field !== effectiveConfig.groupBy
            ).map((field) => ({
              value: field,
              label: DIMENSION_LABELS[field],
            })),
          ]}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              sliceBy: value === 'none' ? null : (value as ConfigMonitorDimensionField),
            }))
          }
        />
        <MonitorControlSelect
          value={effectiveConfig.verticalGroupBy ?? 'none'}
          label='Swimlane'
          disabled={controlsDisabled}
          triggerClassName='w-[150px]'
          options={[
            { value: 'none', label: 'None' },
            ...CONFIG_MONITOR_DIMENSION_FIELDS.filter(
              (field) => field !== effectiveConfig.groupBy && field !== effectiveConfig.sliceBy
            ).map((field) => ({
              value: field,
              label: DIMENSION_LABELS[field],
            })),
          ]}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              verticalGroupBy: value === 'none' ? null : (value as ConfigMonitorDimensionField),
            }))
          }
        />
        <MonitorControlSelect
          value={activeSort?.field ?? 'manual'}
          label='Sort'
          disabled={controlsDisabled}
          triggerClassName='w-[150px]'
          options={[
            { value: 'manual', label: 'Manual order' },
            ...CONFIG_MONITOR_SORT_FIELDS.map((field) => ({
              value: field,
              label: SORT_LABELS[field],
            })),
          ]}
          onValueChange={(value) =>
            onUpdateViewConfig((current) => ({
              ...current,
              sortBy:
                value !== 'manual'
                  ? [
                    {
                      field: value as ConfigMonitorSortField,
                      direction: current.sortBy[0]?.direction ?? 'asc',
                    },
                  ]
                  : [],
            }))
          }
        />
        <MonitorControlMenu
          label='Sums'
          value={summarizeConfigFieldSums(effectiveConfig.fieldSums)}
          disabled={controlsDisabled}
          contentClassName='w-44'
        >
          {CONFIG_MONITOR_FIELD_SUMS.map((field) => (
            <DropdownMenuCheckboxItem
              key={field}
              checked={effectiveConfig.fieldSums.includes(field)}
              onCheckedChange={() => handleFieldSumToggle(field)}
            >
              {FIELD_SUM_LABELS[field]}
            </DropdownMenuCheckboxItem>
          ))}
        </MonitorControlMenu>
        <MonitorControlMenu
          label='Fields'
          value={summarizeConfigVisibleFields(effectiveConfig.kanban.visibleFieldIds)}
          disabled={controlsDisabled}
          contentClassName='w-52'
        >
          {CONFIG_MONITOR_VISIBLE_FIELDS.map((field) => (
            <DropdownMenuCheckboxItem
              key={field}
              checked={effectiveConfig.kanban.visibleFieldIds.includes(field)}
              onCheckedChange={() => handleVisibleFieldToggle(field)}
            >
              {VISIBLE_LABELS[field]}
            </DropdownMenuCheckboxItem>
          ))}
        </MonitorControlMenu>
      </MonitorControlBar>

      {noticeMessage ? <Notice variant='warning'>{noticeMessage}</Notice> : null}

      {monitorsLoading ? (
        <MonitorStateCard loadingLabel='Loading monitor records...' className='h-full' />
      ) : (
        <MonitorConfigBoard
          sections={sections}
          selectedMonitorId={editorState.selectedMonitorId}
          visibleFieldIds={effectiveConfig.kanban.visibleFieldIds}
          timezone={effectiveConfig.timezone}
          canReorder={canReorder}
          onSelectCard={(card) => editorState.openEdit(card.sourceMonitor)}
          onCreateInContext={editorState.openCreateFromBoardContext}
          onMoveCard={(monitorId, context) => {
            void handleMoveCard(monitorId, context)
          }}
          onReorderBucketCards={handleReorderBucketCards}
        />
      )}
    </div>
  )

  const editor = (
    <MonitorEditorPanel
      workspaceId={workspaceId}
      editorState={editorState}
      referenceData={referenceData}
      createDisabled={controlsDisabled}
    />
  )

  return (
    <div className='w-full flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden p-1.5'>
      {isMobile ? (
        <div className='min-h-0 flex-1'>
          {board}
          {editor}
        </div>
      ) : (
        <ResizablePanelGroup
          direction='horizontal'
          onLayout={onPanelLayout}
          className='min-h-0 flex-1'
        >
          <ResizablePanel
            defaultSize={panelSizes?.[0] ?? DEFAULT_CONFIG_PANEL_SIZES[0]}
            minSize={35}
          >
            {board}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={panelSizes?.[1] ?? DEFAULT_CONFIG_PANEL_SIZES[1]}
            minSize={25}
          >
            <div className='h-full pl-1.5'>{editor}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
