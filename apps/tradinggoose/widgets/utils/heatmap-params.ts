import { useEffect, useRef } from 'react'
import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import {
  HEATMAP_WIDGET_UPDATE_PARAMS_EVENT,
  type HeatmapWidgetUpdateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UseHeatmapParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const areValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => areValuesEqual(value, right[index]))
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => key in right && areValuesEqual(left[key], right[key]))
  }

  return false
}

export const sanitizeHeatmapParams = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!params || !isRecord(params)) return null

  const sourceMode = normalizeString(params.sourceMode)
  const watchlistSizeMetric = normalizeString(params.watchlistSizeMetric)
  const marketProvider = normalizeString(params.marketProvider)
  const tradingProvider = normalizeString(params.tradingProvider)
  const credentialServiceId = normalizeString(params.credentialServiceId)
  const accountId = normalizeString(params.accountId)
  const marketProviderParams = sanitizeMarketProviderParamsForWidget(
    marketProvider,
    params.marketProviderParams
  )
  const marketAuth = sanitizeMarketProviderAuth(params.marketAuth)
  const runtime = isRecord(params.runtime) ? params.runtime : null
  const refreshAt =
    typeof runtime?.refreshAt === 'number' && Number.isFinite(runtime.refreshAt)
      ? runtime.refreshAt
      : undefined

  const nextParams: Record<string, unknown> = {}
  if (sourceMode === 'watchlist' || sourceMode === 'portfolio') nextParams.sourceMode = sourceMode
  if (watchlistSizeMetric === 'volume' || watchlistSizeMetric === 'volumeUsd') {
    nextParams.watchlistSizeMetric = watchlistSizeMetric
  }
  if (marketProvider) nextParams.marketProvider = marketProvider
  if (marketProviderParams) nextParams.marketProviderParams = marketProviderParams
  if (marketAuth) nextParams.marketAuth = marketAuth
  if (tradingProvider) nextParams.tradingProvider = tradingProvider
  if (credentialServiceId) nextParams.credentialServiceId = credentialServiceId
  if (accountId) nextParams.accountId = accountId
  if (refreshAt !== undefined) nextParams.runtime = { refreshAt }

  return Object.keys(nextParams).length > 0 ? nextParams : null
}

const mergeHeatmapParams = (
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
) => {
  const currentRuntime = isRecord(currentParams?.runtime) ? currentParams.runtime : null
  const incomingRuntime = isRecord(incomingParams.runtime) ? incomingParams.runtime : null
  const mergedRuntime =
    currentRuntime || incomingRuntime
      ? {
          ...(currentRuntime ?? {}),
          ...(incomingRuntime ?? {}),
        }
      : undefined

  return sanitizeHeatmapParams({
    ...(currentParams ?? {}),
    ...incomingParams,
    ...(mergedRuntime ? { runtime: mergedRuntime } : {}),
  })
}

export function useHeatmapParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UseHeatmapParamsPersistenceOptions) {
  const latestParamsRef = useRef<Record<string, unknown> | null>(sanitizeHeatmapParams(params))

  useEffect(() => {
    latestParamsRef.current = sanitizeHeatmapParams(params)
  }, [params])

  useEffect(() => {
    if (!onWidgetParamsChange) return

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<HeatmapWidgetUpdateEventDetail>).detail
      if (!detail?.params || !isRecord(detail.params)) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams = latestParamsRef.current
      const nextParams = mergeHeatmapParams(currentParams, detail.params)
      if (areValuesEqual(currentParams, nextParams)) return

      latestParamsRef.current = nextParams
      onWidgetParamsChange(nextParams)
    }

    window.addEventListener(HEATMAP_WIDGET_UPDATE_PARAMS_EVENT, handleParamsUpdate)

    return () => {
      window.removeEventListener(HEATMAP_WIDGET_UPDATE_PARAMS_EVENT, handleParamsUpdate)
    }
  }, [onWidgetParamsChange, panelId, widget?.key])
}

export function emitHeatmapParamsChange({
  params,
  panelId,
  widgetKey,
}: {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<HeatmapWidgetUpdateEventDetail>(HEATMAP_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}
