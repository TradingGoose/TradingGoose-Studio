'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { DEFAULT_INDICATOR_MAP } from '@/lib/indicators/default'
import type { InputMetaMap } from '@/lib/indicators/types'
import { useSocket } from '@/contexts/socket-context'
import { useIndicators } from '@/hooks/queries/indicators'
import type { MarketSessionWindow } from '@/providers/market/types'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useDataChartParamsPersistence } from '@/widgets/utils/chart-params'
import { ChartPaneOverlays } from '@/widgets/widgets/data_chart/components/chart-pane-overlays'
import { DrawToolsSidebar } from '@/widgets/widgets/data_chart/components/draw-tools-sidebar'
import { DataChartFooter } from '@/widgets/widgets/data_chart/components/footer'
import { IndicatorSettingsModal } from '@/widgets/widgets/data_chart/components/indicator-settings-modal'
import { useChartDataLoader } from '@/widgets/widgets/data_chart/hooks/use-chart-data-loader'
import { useChartDefaults } from '@/widgets/widgets/data_chart/hooks/use-chart-defaults'
import { useChartInstance } from '@/widgets/widgets/data_chart/hooks/use-chart-instance'
import { useChartLegend } from '@/widgets/widgets/data_chart/hooks/use-chart-legend'
import { useChartStyles } from '@/widgets/widgets/data_chart/hooks/use-chart-styles'
import { useChartVisibleRange } from '@/widgets/widgets/data_chart/hooks/use-chart-visible-range'
import { useIndicatorControls } from '@/widgets/widgets/data_chart/hooks/use-indicator-controls'
import { useIndicatorLegend } from '@/widgets/widgets/data_chart/hooks/use-indicator-legend'
import { useIndicatorSync } from '@/widgets/widgets/data_chart/hooks/use-indicator-sync'
import { useListingState } from '@/widgets/widgets/data_chart/hooks/use-listing-state'
import { useManualDrawToolsController } from '@/widgets/widgets/data_chart/hooks/use-manual-draw-tools-controller'
import { usePaneLayoutController } from '@/widgets/widgets/data_chart/hooks/use-pane-layout-controller'
import { useThemeVersion } from '@/widgets/widgets/data_chart/hooks/use-theme-version'
import type { BarMs } from '@/widgets/widgets/data_chart/series-data'
import { intervalToMs } from '@/widgets/widgets/data_chart/series-data'
import { resolveSeriesWindow } from '@/widgets/widgets/data_chart/series-window'
import type {
  DataChartDataContext,
  DataChartWidgetParams,
  dataChartWidgetParams,
  IndicatorRuntimeEntry,
} from '@/widgets/widgets/data_chart/types'
import {
  buildIndicatorRefs,
  resolveIndicatorIds,
} from '@/widgets/widgets/data_chart/utils/indicator-refs'
import { getListingSymbol } from '@/widgets/widgets/data_chart/utils/listing-utils'

const DRAW_TOOLS_SIDEBAR_WIDTH_PX = 40
const LEFT_OVERLAY_GAP_PX = 3
const LEFT_OVERLAY_INSET_PX = DRAW_TOOLS_SIDEBAR_WIDTH_PX + LEFT_OVERLAY_GAP_PX
const DRAW_TRACE_STORAGE_KEY = 'tg:data-chart:draw-trace'

export const DataChartWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)
  useDataChartParamsPersistence({ onWidgetParamsChange, panelId, widget, params })

  const dataParams = useMemo(() => {
    if (!params || typeof params !== 'object') return {}
    return params as dataChartWidgetParams
  }, [params])
  const widgetKey = widget?.key ?? 'data_chart'

  const providerId = dataParams.data?.provider
  const listingValue =
    resolvedPairColor !== 'gray' ? (pairContext.listing ?? null) : (dataParams.listing ?? null)
  const seriesWindow = useMemo(
    () => resolveSeriesWindow(dataParams as DataChartWidgetParams, providerId),
    [providerId, dataParams.view?.interval, dataParams.view?.rangePresetId]
  )

  const intervalLabel = seriesWindow.interval ?? ''
  const { listing, listingIdentitySignature, resolvedListing, isResolving } = useListingState({
    listingValue,
    intervalLabel,
  })
  const listingLabel = useMemo(() => {
    if (resolvedListing) {
      const symbol = getListingSymbol(resolvedListing)
      const name = resolvedListing.name?.trim() ?? ''
      if (symbol && name && name !== symbol) {
        return `${symbol} · ${name}`
      }
      if (symbol) return symbol
      if (name) return name
      return null
    }
    return null
  }, [resolvedListing])

  const chartResetKey = useMemo(
    () => [providerId ?? 'none', listingIdentitySignature ?? 'none'].join('|'),
    [listingIdentitySignature, providerId]
  )

  const {
    chartRef,
    chartContainerRef,
    chartContainerCallbackRef,
    mainSeriesRef,
    chartReady,
    registerBeforeDestroy,
  } = useChartInstance(chartResetKey)
  const { socket } = useSocket()
  const [dataVersion, setDataVersion] = useState(0)
  const lastLiveRefreshRef = useRef(0)
  const dataContext = useMemo<DataChartDataContext>(
    () => ({
      barsMsRef: { current: [] as BarMs[] },
      indexByOpenTimeMsRef: { current: new Map<number, number>() },
      openTimeMsByIndexRef: { current: [] as number[] },
      marketSessionsRef: { current: [] as MarketSessionWindow[] },
      intervalMs: null,
      dataVersion: 0,
    }),
    [chartResetKey]
  )
  const indicatorRuntimeRef = useMemo(
    () => ({ current: new Map<string, IndicatorRuntimeEntry>() }),
    [chartResetKey]
  )
  const [indicatorRuntimeVersion, setIndicatorRuntimeVersion] = useState(0)
  const { paneSnapshot, paneLayout, handleMovePaneUp, handleMovePaneDown } =
    usePaneLayoutController({
      chartRef,
      chartContainerRef,
      chartReady,
      indicatorRuntimeVersion,
      chartResetKey,
    })
  const legendContainerRef = useRef<HTMLDivElement | null>(null)
  const [legendOffset, setLegendOffset] = useState(0)

  const traceDrawRouting = useCallback(
    (event: string, details?: () => Record<string, unknown>) => {
      if (typeof window === 'undefined') return
      let enabled = false
      try {
        enabled =
          (window as { __TG_DRAW_TRACE__?: boolean }).__TG_DRAW_TRACE__ === true ||
          window.localStorage.getItem(DRAW_TRACE_STORAGE_KEY) === '1'
      } catch {
        enabled = false
      }
      if (!enabled) return
      const payload = details ? details() : {}
      console.info(`[data-chart/draw-trace] ${event}`, {
        panelId,
        widgetKey,
        chartResetKey,
        ...payload,
      })
    },
    [panelId, widgetKey, chartResetKey]
  )

  useChartDefaults({
    dataParams: dataParams as DataChartWidgetParams,
    providerId,
    seriesWindow,
    onWidgetParamsChange,
    resolvedPairColor,
    panelId,
    widgetKey,
  })

  const intervalMs = intervalToMs(seriesWindow.interval ?? seriesWindow.requestInterval ?? null)
  dataContext.intervalMs = intervalMs
  dataContext.dataVersion = dataVersion

  const themeVersion = useThemeVersion()
  const handleDataLoaded = useCallback(() => {
    setDataVersion((prev) => prev + 1)
  }, [])
  const handleDataUpdated = useCallback(() => {
    const now = Date.now()
    if (now - lastLiveRefreshRef.current < 10000) return
    lastLiveRefreshRef.current = now
    setDataVersion((prev) => prev + 1)
  }, [])
  const handleDataBackfill = useCallback(() => {
    setDataVersion((prev) => prev + 1)
  }, [])
  const handleIndicatorRuntimeChange = useCallback(() => {
    setIndicatorRuntimeVersion((prev) => prev + 1)
  }, [])

  const { seriesTimezone, chartError, isLoading } = useChartDataLoader({
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartReady,
    socket,
    workspaceId,
    providerId,
    listing,
    seriesWindow,
    dataParams,
    dataContext,
    onDataLoaded: handleDataLoaded,
    onDataUpdated: handleDataUpdated,
    onDataBackfill: handleDataBackfill,
  })

  const { data: pineIndicators = [] } = useIndicators(workspaceId ?? '')
  const pineIndicatorIds = useMemo(
    () => resolveIndicatorIds(dataParams.view),
    [dataParams.view?.pineIndicators]
  )
  const pineIndicatorRefs = useMemo(
    () =>
      buildIndicatorRefs(
        pineIndicatorIds,
        Array.isArray(dataParams.view?.pineIndicators) ? dataParams.view?.pineIndicators : []
      ),
    [pineIndicatorIds, dataParams.view?.pineIndicators]
  )
  const indicatorRefsById = useMemo(
    () => new Map(pineIndicatorRefs.map((ref) => [ref.id, ref])),
    [pineIndicatorRefs]
  )
  const hiddenIndicators = useMemo(() => {
    const hidden = new Set<string>()
    pineIndicatorRefs.forEach((ref) => {
      if (ref.visible === false) {
        hidden.add(ref.id)
      }
    })
    return hidden
  }, [pineIndicatorRefs])
  const indicatorMetaById = useMemo(() => {
    const customMap = new Map(pineIndicators.map((indicator) => [indicator.id, indicator]))
    const metaMap = new Map<string, { name: string; inputMeta?: InputMetaMap | null }>()
    pineIndicatorIds.forEach((id) => {
      const custom = customMap.get(id)
      const fallback = DEFAULT_INDICATOR_MAP.get(id) ?? null
      metaMap.set(id, {
        name: custom?.name ?? fallback?.name ?? id,
        inputMeta: custom?.inputMeta ?? fallback?.inputMeta ?? undefined,
      })
    })
    return metaMap
  }, [pineIndicators, pineIndicatorIds])

  useIndicatorSync({
    chartRef,
    mainSeriesRef,
    dataContext,
    workspaceId,
    indicatorRefs: pineIndicatorRefs,
    indicators: pineIndicators,
    listing,
    interval: seriesWindow.interval ?? seriesWindow.requestInterval ?? undefined,
    viewStartMs: dataParams.view?.start,
    viewEndMs: dataParams.view?.end,
    chartReady,
    indicatorRuntimeRef,
    onIndicatorRuntimeChange: handleIndicatorRuntimeChange,
  })

  useChartVisibleRange({
    chartRef,
    dataContext,
    params: dataParams,
    chartReady,
    interval: seriesWindow.interval ?? seriesWindow.requestInterval ?? null,
    panelId,
    widgetKey,
  })

  const legendData = useChartLegend({
    chartRef,
    mainSeriesRef,
    dataContext,
    chartReady,
    seriesTimezone,
    view: dataParams.view,
  })
  const indicatorLegend = useIndicatorLegend({
    chartRef,
    indicatorRuntimeRef,
    view: dataParams.view,
    chartReady,
    dataVersion,
    runtimeVersion: indicatorRuntimeVersion,
  })
  const {
    settingsIndicatorId,
    settingsDraft,
    settingsMeta,
    handleToggleHidden,
    handleRemoveIndicator,
    handleOpenSettings,
    handleCloseSettings,
    handleSaveSettings,
    handleDraftChange,
    indicatorControlsByPane,
    hasIndicatorRuntime,
  } = useIndicatorControls({
    view: dataParams.view,
    panelId,
    widgetKey,
    pineIndicatorIds,
    indicatorMetaById,
    indicatorRefsById,
    indicatorLegend,
    hiddenIndicators,
    indicatorRuntimeRef,
    indicatorRuntimeVersion,
    mainSeriesRef,
    paneSnapshot,
    chartResetKey,
  })
  const {
    activeManualOwnerId,
    hasActiveOwnerTools,
    activeOwnerVisibilityMode,
    resolveManualToolCapability,
    resolveNonSelectableToolActive,
    handleSelectManualTool,
    handleToggleAllManualVisibility,
    handleClearManualTools,
    handleHideSelectedDrawings,
    handleRemoveSelectedDrawings,
    resolveSelectedOwnerForPane,
  } = useManualDrawToolsController({
    view: dataParams.view,
    panelId,
    widgetKey,
    chartResetKey,
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartReady,
    registerBeforeDestroy,
    dataVersion,
    indicatorRuntimeRef,
    indicatorRuntimeVersion,
    paneSnapshot,
    paneLayout,
    traceDrawRouting,
  })

  const chartSettings = useMemo(() => {
    const view = dataParams.view ?? {}
    return {
      locale: view.locale,
      timezone: view.timezone,
      pricePrecision: view.pricePrecision,
      volumePrecision: view.volumePrecision,
      candleType: view.candleType,
      priceAxisType: view.priceAxisType,
      stylesOverride: view.stylesOverride,
    }
  }, [
    dataParams.view?.locale,
    dataParams.view?.timezone,
    dataParams.view?.pricePrecision,
    dataParams.view?.volumePrecision,
    dataParams.view?.candleType,
    dataParams.view?.priceAxisType,
    dataParams.view?.stylesOverride,
  ])

  useChartStyles({
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartSettings,
    seriesTimezone,
    themeVersion,
    dataContext,
    chartReady,
  })

  useEffect(() => {
    indicatorRuntimeRef.current.forEach((entry, indicatorId) => {
      const isHidden = hiddenIndicators.has(indicatorId)
      entry.plots.forEach((plot) => {
        if (typeof (plot.series as { applyOptions?: unknown }).applyOptions === 'function') {
          ;(plot.series as { applyOptions: (options: { visible: boolean }) => void }).applyOptions({
            visible: !isHidden,
          })
        }
      })
    })
  }, [hiddenIndicators, indicatorRuntimeVersion])

  useEffect(() => {
    const element = legendContainerRef.current
    if (!element) {
      setLegendOffset(0)
      return
    }
    const update = () => {
      setLegendOffset(element.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [legendData, listingLabel, resolvedListing, isResolving, intervalLabel])

  const hasProvider = Boolean(providerId)
  const hasListing = Boolean(listing)
  const showEmptyState = !hasProvider || !hasListing
  const showErrorState = !showEmptyState && Boolean(chartError) && !isLoading

  if (!workspaceId) {
    return (
      <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
        Select a workspace to load chart data.
      </div>
    )
  }

  const emptyTitle = !hasProvider
    ? hasListing
      ? 'Select a provider'
      : 'Select a provider and listing'
    : 'Select a listing'
  const emptyDescription = !hasProvider
    ? hasListing
      ? 'Choose a provider to display chart data.'
      : 'Choose a provider and listing to display chart data.'
    : 'Choose a listing to display chart data.'

  const errorTitle = 'Failed to load data'
  const errorDescription = chartError ?? 'Unable to load chart data.'

  return (
    <div className='relative flex h-full w-full flex-col'>
      <div className='relative flex-1 overflow-hidden'>
        {!showEmptyState && !showErrorState && (
          <DrawToolsSidebar
            activeOwnerId={activeManualOwnerId}
            sidebarWidthPx={DRAW_TOOLS_SIDEBAR_WIDTH_PX}
            hasOwnerTools={hasActiveOwnerTools}
            allVisibilityMode={activeOwnerVisibilityMode}
            getToolCapability={resolveManualToolCapability}
            isNonSelectableToolActive={resolveNonSelectableToolActive}
            onSelectTool={handleSelectManualTool}
            onToggleAllVisibility={handleToggleAllManualVisibility}
            onClearAll={handleClearManualTools}
          />
        )}
        <div
          ref={chartContainerCallbackRef}
          aria-hidden={showErrorState}
          className={`relative z-0 h-full w-full bg-background text-foreground${
            showErrorState ? ' pointer-events-none opacity-0' : ''
          }`}
        />
        {!showEmptyState && !showErrorState && (
          <ChartPaneOverlays
            paneSnapshot={paneSnapshot}
            paneLayout={paneLayout}
            mainPaneIndex={mainSeriesRef.current?.getPane().paneIndex() ?? 0}
            legendOffset={legendOffset}
            legendData={legendData}
            listingLabel={listingLabel}
            resolvedListing={resolvedListing}
            intervalLabel={intervalLabel}
            isResolving={isResolving}
            legendContainerRef={legendContainerRef}
            leftOverlayInsetPx={LEFT_OVERLAY_INSET_PX}
            indicatorControlsByPane={indicatorControlsByPane}
            hasIndicatorRuntime={hasIndicatorRuntime}
            resolveSelectedOwnerForPane={resolveSelectedOwnerForPane}
            onToggleHidden={handleToggleHidden}
            onRemoveIndicator={handleRemoveIndicator}
            onOpenSettings={handleOpenSettings}
            onHideSelectedDrawings={handleHideSelectedDrawings}
            onRemoveSelectedDrawings={handleRemoveSelectedDrawings}
            onMovePaneUp={handleMovePaneUp}
            onMovePaneDown={handleMovePaneDown}
          />
        )}
        {showEmptyState && (
          <div className='absolute inset-0 z-10 flex'>
            <Empty className='h-full w-full border-border/40 bg-background/60'>
              <EmptyHeader>
                <EmptyTitle>{emptyTitle}</EmptyTitle>
                <EmptyDescription>{emptyDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
        {showErrorState && (
          <div className='absolute inset-0 z-10 flex'>
            <Empty className='h-full w-full border-border/40 bg-background/60'>
              <EmptyHeader>
                <EmptyTitle>{errorTitle}</EmptyTitle>
                <EmptyDescription>{errorDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
      <IndicatorSettingsModal
        indicatorId={settingsIndicatorId}
        meta={settingsMeta}
        draft={settingsDraft}
        onDraftChange={handleDraftChange}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
      />
      <DataChartFooter
        params={dataParams as DataChartWidgetParams}
        widgetKey={widgetKey}
        panelId={panelId}
        allowedIntervals={seriesWindow.allowedIntervals}
        exchangeTimezone={seriesTimezone}
      />
    </div>
  )
}
