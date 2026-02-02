'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useSocket } from '@/contexts/socket-context'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useDataChartParamsPersistence } from '@/widgets/utils/chart-params'
import { useListingState } from '@/widgets/widgets/new_data_chart/hooks/use-listing-state'
import { useChartDefaults } from '@/widgets/widgets/new_data_chart/hooks/use-chart-defaults'
import { useThemeVersion } from '@/widgets/widgets/new_data_chart/hooks/use-theme-version'
import { DataChartFooter } from '@/widgets/widgets/new_data_chart/components/footer'
import type { DataChartWidgetParams } from '@/widgets/widgets/new_data_chart/types'
import { resolveSeriesWindow } from '@/widgets/widgets/new_data_chart/series-window'
import { intervalToMs } from '@/widgets/widgets/new_data_chart/series-data'
import { useChartInstance } from '@/widgets/widgets/new_data_chart/hooks/use-chart-instance'
import { useChartDataLoader } from '@/widgets/widgets/new_data_chart/hooks/use-chart-data-loader'
import { useChartStyles } from '@/widgets/widgets/new_data_chart/hooks/use-chart-styles'
import { useChartVisibleRange } from '@/widgets/widgets/new_data_chart/hooks/use-chart-visible-range'
import { useChartLegend } from '@/widgets/widgets/new_data_chart/hooks/use-chart-legend'
import { ChartLegend } from '@/widgets/widgets/new_data_chart/components/chart-legend'
import { getListingSymbol } from '@/widgets/widgets/new_data_chart/utils/listing-utils'
import type {
  NewDataChartDataContext,
  NewDataChartWidgetParams,
} from '@/widgets/widgets/new_data_chart/types'
import type { BarMs } from '@/widgets/widgets/new_data_chart/series-data'
import type { MarketSessionWindow } from '@/providers/market/types'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'

export const NewDataChartWidgetBody = ({
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
  const { chartRef, chartContainerRef, mainSeriesRef, chartReady } = useChartInstance()
  const { socket } = useSocket()
  const [dataVersion, setDataVersion] = useState(0)
  const lastLiveRefreshRef = useRef(0)
  const barsMsRef = useRef<BarMs[]>([])
  const indexByOpenTimeMsRef = useRef<Map<number, number>>(new Map())
  const openTimeMsByIndexRef = useRef<number[]>([])
  const marketSessionsRef = useRef<MarketSessionWindow[]>([])
  const dataContextRef = useRef<NewDataChartDataContext>({
    barsMsRef,
    indexByOpenTimeMsRef,
    openTimeMsByIndexRef,
    marketSessionsRef,
    intervalMs: null,
    dataVersion: 0,
  })

  useDataChartParamsPersistence({ onWidgetParamsChange, panelId, widget, params })

  const dataParams = useMemo(() => {
    if (!params || typeof params !== 'object') return {}
    return params as NewDataChartWidgetParams
  }, [params])
  const widgetKey = widget?.key ?? 'new_data_chart'

  const providerId = dataParams.data?.provider
  const listingValue =
    resolvedPairColor !== 'gray' ? (pairContext.listing ?? null) : (dataParams.listing ?? null)
  const seriesWindow = useMemo(
    () => resolveSeriesWindow(dataParams as DataChartWidgetParams, providerId),
    [
      providerId,
      dataParams.data?.interval,
      dataParams.view?.interval,
      dataParams.view?.rangePresetId,
    ]
  )

  const intervalLabel = seriesWindow.interval ?? ''
  const { listing, resolvedListing, isResolving } = useListingState({
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

  useChartDefaults({
    dataParams: dataParams as DataChartWidgetParams,
    providerId,
    seriesWindow,
    onWidgetParamsChange,
    resolvedPairColor,
  })

  const intervalMs = intervalToMs(seriesWindow.interval ?? seriesWindow.requestInterval ?? null)
  dataContextRef.current.intervalMs = intervalMs
  dataContextRef.current.dataVersion = dataVersion
  const dataContext = dataContextRef.current

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

  const { seriesTimezone, chartError } = useChartDataLoader({
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    socket,
    providerId,
    listing,
    seriesWindow,
    dataParams,
    dataContext,
    onDataLoaded: handleDataLoaded,
    onDataUpdated: handleDataUpdated,
    onDataBackfill: handleDataBackfill,
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
    seriesTimezone,
    view: dataParams.view,
    dataVersion,
  })

  const chartSettings = useMemo(
    () => {
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
    },
    [
      dataParams.view?.locale,
      dataParams.view?.timezone,
      dataParams.view?.pricePrecision,
      dataParams.view?.volumePrecision,
      dataParams.view?.candleType,
      dataParams.view?.priceAxisType,
      dataParams.view?.stylesOverride,
    ]
  )

  useChartStyles({
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartSettings,
    seriesTimezone,
    themeVersion,
    dataContext,
    dataVersion,
    chartReady,
  })

  const hasProvider = Boolean(providerId)
  const hasListing = Boolean(listing)
  const showEmptyState = !hasProvider || !hasListing
  const showErrorState = !showEmptyState && Boolean(chartError)

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
    <div className='flex h-full w-full flex-col'>
      <div className='relative flex-1 overflow-hidden'>
        <div
          ref={chartContainerRef}
          aria-hidden={showErrorState}
          className={`relative z-0 h-full w-full bg-background text-foreground${
            showErrorState ? ' opacity-0 pointer-events-none' : ''
          }`}
        />
        {!showEmptyState && !showErrorState && (
          <ChartLegend
            legend={legendData}
            listingLabel={listingLabel}
            listing={resolvedListing}
            intervalLabel={intervalLabel}
            isResolving={isResolving}
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
