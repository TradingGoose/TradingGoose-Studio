'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useSocket } from '@/contexts/socket-context'
import { useCustomIndicators } from '@/hooks/queries/custom-indicators'
import { useCustomIndicatorsStore } from '@/stores/custom-indicators/store'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useDataChartParamsPersistence } from '@/widgets/utils/chart-params'
import {
  ChartStateOverlays,
  WidgetStateMessage,
} from '@/widgets/widgets/data_chart/components/body/chart-state-overlays'
import {
  ListingOverlay,
  useListingState,
} from '@/widgets/widgets/data_chart/components/body/listing'
import { useChartDataLoader } from '@/widgets/widgets/data_chart/components/body/use-chart-data-loader'
import { useChartDefaults } from '@/widgets/widgets/data_chart/components/body/use-chart-defaults'
import { useChartInstance } from '@/widgets/widgets/data_chart/components/body/use-chart-instance'
import { useChartStyles } from '@/widgets/widgets/data_chart/components/body/use-chart-styles'
import { useChartSymbol } from '@/widgets/widgets/data_chart/components/body/use-chart-symbol'
import { useIndicatorSync } from '@/widgets/widgets/data_chart/components/body/use-indicator-sync'
import { useThemeVersion } from '@/widgets/widgets/data_chart/components/body/use-theme-version'
import { DataChartFooter } from '@/widgets/widgets/data_chart/components/footer'
import { EMPTY_INDICATORS } from '@/widgets/widgets/data_chart/constants'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { resolveSeriesWindow } from '@/widgets/widgets/data_chart/utils'

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
  const indicatorInstanceMapRef = useRef<Record<string, string>>({})
  const { chartRef, chartContainerRef } = useChartInstance()
  const { socket } = useSocket()
  const [dataVersion, setDataVersion] = useState(0)
  const lastLiveRefreshRef = useRef(0)

  useDataChartParamsPersistence({ onWidgetParamsChange, panelId, widget, params })

  const dataParams = useMemo(() => {
    if (!params || typeof params !== 'object') return {}
    return params as DataChartWidgetParams
  }, [params])

  const providerId = dataParams.data?.provider
  const listingValue =
    resolvedPairColor !== 'gray' ? (pairContext.listing ?? null) : (dataParams.listing ?? null)
  const seriesWindow = useMemo(
    () => resolveSeriesWindow(dataParams, providerId),
    [dataParams, providerId]
  )

  useCustomIndicators(workspaceId ?? '')
  const indicators = useCustomIndicatorsStore((state) => {
    const list = state.getAllIndicators(workspaceId ?? undefined)
    return list.length ? list : EMPTY_INDICATORS
  })
  const indicatorRefs = Array.isArray(dataParams.view?.indicators)
    ? dataParams.view?.indicators
    : []

  const intervalLabel = seriesWindow.interval ?? ''
  const { listing, listingKey, tooltipTitle, resolvedListing, isResolving } = useListingState({
    listingValue,
    intervalLabel,
  })
  const hasCustomTooltipTitleOverride = useMemo(() => {
    const title = (
      dataParams.view?.stylesOverride as {
        candle?: { tooltip?: { title?: { template?: unknown; show?: unknown } } }
      }
    )?.candle?.tooltip?.title
    if (!title) return false
    const template = title.template
    return typeof template === 'string' || typeof title.show === 'boolean'
  }, [dataParams.view?.stylesOverride])

  useChartDefaults({
    dataParams,
    providerId,
    seriesWindow,
    onWidgetParamsChange,
    resolvedPairColor,
  })

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

  const { chartError, seriesTimezone } = useChartDataLoader({
    chartRef,
    chartContainerRef,
    socket,
    workspaceId,
    providerId,
    listing,
    seriesWindow,
    dataParams,
    onDataLoaded: handleDataLoaded,
    onDataUpdated: handleDataUpdated,
  })
  const chartWarnings = useIndicatorSync({
    chartRef,
    indicatorInstanceMapRef,
    workspaceId,
    indicatorRefs,
    indicators,
    providerId,
    dataVersion,
  })

  useChartStyles({
    chartRef,
    chartContainerRef,
    chartSettings: dataParams.view,
    seriesTimezone,
    themeVersion,
    hasCustomTooltipTitleOverride,
  })

  useChartSymbol({
    chartRef,
    listingKey,
    pricePrecision: dataParams.view?.pricePrecision,
    volumePrecision: dataParams.view?.volumePrecision,
    interval: seriesWindow.interval,
    tooltipTitle,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to load chart data.' />
  }

  const missingProvider = !providerId
  const missingListing = !listing
  const missingInterval = seriesWindow.supportsInterval && !seriesWindow.interval
  const missingMessage = missingProvider
    ? 'Select a market data provider.'
    : missingListing
      ? 'Select a listing to load data.'
      : missingInterval
        ? 'Select a supported interval.'
        : null

  return (
    <div className='flex h-full w-full flex-col'>
      <div className='relative flex-1 overflow-hidden'>
        <div ref={chartContainerRef} className='relative z-0 h-full w-full' />
        <ListingOverlay
          listing={resolvedListing}
          intervalLabel={intervalLabel}
          isResolving={isResolving}
        />
        <ChartStateOverlays
          missingMessage={missingMessage}
          chartError={chartError}
          chartWarnings={chartWarnings}
        />
      </div>
      <DataChartFooter
        params={dataParams}
        widgetKey={widget?.key}
        panelId={panelId}
        allowedIntervals={seriesWindow.allowedIntervals}
        exchangeTimezone={seriesTimezone}
      />
    </div>
  )
}
