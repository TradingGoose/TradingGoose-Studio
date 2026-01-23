import {
  coerceMarketProviderParamValue,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import {
  MARKET_INTERVALS,
  type MarketInterval,
  type NormalizationMode,
} from '@/providers/market/types'
import { DEFAULT_INDICATOR_MAP } from '@/lib/indicators/default'
import { DEFAULT_BAR_COUNT, DEFAULT_RANGE_PRESETS, intervalToMs } from './remapping'
import type { DataChartIndicatorRef, DataChartWidgetParams, DataChartWindow } from './types'

export const parseDateInput = (value?: string | number | null) => {
  if (value === undefined || value === null) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

const rangeToMs = (range?: { value: number; unit: 'day' | 'week' | 'month' | 'year' }) => {
  if (!range) return null
  const value = Number(range.value)
  if (!Number.isFinite(value) || value <= 0) return null
  const dayMs = 24 * 60 * 60 * 1000
  if (range.unit === 'day') return value * dayMs
  if (range.unit === 'week') return value * 7 * dayMs
  if (range.unit === 'month') return value * 30 * dayMs
  if (range.unit === 'year') return value * 365 * dayMs
  return null
}

export const chooseIntervalForRange = (
  rangeMs: number,
  allowedIntervals: MarketInterval[],
  targetBars = DEFAULT_BAR_COUNT
): MarketInterval | undefined => {
  if (!allowedIntervals.length || rangeMs <= 0) return undefined
  let best = allowedIntervals[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const interval of allowedIntervals) {
    const intervalMs = intervalToMs(interval)
    if (!intervalMs) continue
    const bars = rangeMs / intervalMs
    const diff = Math.abs(bars - targetBars)
    if (diff < bestDiff) {
      bestDiff = diff
      best = interval
    }
  }
  return best
}

export const resolveAxisName = (value?: string | null) => {
  if (!value) return undefined
  if (value === 'log') return 'logarithm'
  if (value === 'percentage') return 'percentage'
  return 'normal'
}

export const areStringArraysEqual = (a: string[], b: string[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export const buildIndicatorRefs = (
  ids: string[],
  customIndicatorIds?: Set<string>
): DataChartIndicatorRef[] => {
  return ids
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => {
      const isCustomOverride = customIndicatorIds?.has(id) ?? false
      const isDefault = DEFAULT_INDICATOR_MAP.has(id) && !isCustomOverride
      if (!isDefault) {
        return { id, isCustom: true }
      }
      return { id, isCustom: false }
    })
}

export const sanitizeNormalizationMode = (
  providerId: string,
  mode?: NormalizationMode | string
): NormalizationMode | undefined => {
  if (!mode) return undefined
  const capabilities = getMarketSeriesCapabilities(providerId)
  if (!capabilities?.normalizationModes?.length) return mode as NormalizationMode
  const allowed = capabilities.normalizationModes
  return allowed.includes(mode as NormalizationMode) ? (mode as NormalizationMode) : undefined
}

export const coerceProviderParams = (
  providerId: string,
  params: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!params || Object.keys(params).length === 0) return undefined
  const definitions = getMarketProviderParamDefinitions(providerId, 'series')
  const nextParams: Record<string, unknown> = { ...params }

  definitions.forEach((definition) => {
    if (!definition?.id) return
    if (!(definition.id in nextParams)) return
    const value = coerceMarketProviderParamValue(definition, nextParams[definition.id])
    if (value === undefined || value === null || value === '') {
      delete nextParams[definition.id]
    } else {
      nextParams[definition.id] = value
    }
  })

  return Object.keys(nextParams).length ? nextParams : undefined
}

export const resolveSeriesWindow = (params: DataChartWidgetParams, providerId?: string | null) => {
  const capabilities = providerId ? getMarketSeriesCapabilities(providerId) : null
  const supportsInterval = capabilities?.supportsInterval !== false
  const allowedIntervals = capabilities?.intervals?.length
    ? capabilities.intervals
    : [...MARKET_INTERVALS]

  const fallbackRange = DEFAULT_RANGE_PRESETS[0]?.range
  const hasExplicitRange = Boolean(params.dataWindow?.range)
  const hasExplicitBarCount =
    typeof params.dataWindow?.barCount === 'number' && Number.isFinite(params.dataWindow.barCount)
  const shouldFallbackRange = !hasExplicitRange && !hasExplicitBarCount
  const dataWindow: DataChartWindow = {
    mode: 'range',
    barCount: hasExplicitBarCount
      ? params.dataWindow?.barCount
      : !hasExplicitRange
        ? DEFAULT_BAR_COUNT
        : undefined,
    range: params.dataWindow?.range ?? (shouldFallbackRange ? fallbackRange : undefined),
    rangeInterval: params.dataWindow?.rangeInterval,
  }

  if (dataWindow.range) {
    dataWindow.barCount = undefined
  }

  let interval: MarketInterval | string | undefined = params.interval
  if (
    interval &&
    allowedIntervals.length > 0 &&
    !allowedIntervals.includes(interval as MarketInterval)
  ) {
    interval = undefined
  }
  if (
    dataWindow.rangeInterval &&
    allowedIntervals.length > 0 &&
    !allowedIntervals.includes(dataWindow.rangeInterval as MarketInterval)
  ) {
    dataWindow.rangeInterval = undefined
  }

  if (!interval && allowedIntervals.length > 0) {
    interval = allowedIntervals.includes('1d' as MarketInterval) ? '1d' : allowedIntervals[0]
  }

  const explicitStart = parseDateInput(params.start)
  const explicitEnd = parseDateInput(params.end)
  let endDate: Date | undefined = explicitEnd ?? undefined
  let startDate: Date | undefined = explicitStart ?? undefined

  const intervalMs = intervalToMs(interval as MarketInterval)
  if (dataWindow.range) {
    const rangeMs = rangeToMs(dataWindow.range)
    if (!dataWindow.rangeInterval && rangeMs) {
      dataWindow.rangeInterval =
        chooseIntervalForRange(rangeMs, allowedIntervals) ?? dataWindow.rangeInterval
    }
    if (!interval && dataWindow.rangeInterval) {
      interval = dataWindow.rangeInterval
    }
  } else if (dataWindow.barCount && intervalMs) {
    const rangeMs = intervalMs * dataWindow.barCount
    dataWindow.range = { value: rangeMs / (24 * 60 * 60 * 1000), unit: 'day' }
    dataWindow.rangeInterval = interval
  } else if (shouldFallbackRange && fallbackRange) {
    dataWindow.range = fallbackRange
    const rangeMs = rangeToMs(fallbackRange)
    if (!dataWindow.rangeInterval && rangeMs) {
      dataWindow.rangeInterval =
        chooseIntervalForRange(rangeMs, allowedIntervals) ?? dataWindow.rangeInterval
    }
    if (!interval && dataWindow.rangeInterval) {
      interval = dataWindow.rangeInterval
    }
  }

  const requestInterval = supportsInterval ? interval : undefined
  const resolvedIntervalMs = intervalToMs(interval as MarketInterval)
  const rangeMs = dataWindow.range ? rangeToMs(dataWindow.range) : null
  const barCountMs =
    resolvedIntervalMs && dataWindow.barCount ? resolvedIntervalMs * dataWindow.barCount : null
  const spanMs = rangeMs ?? barCountMs

  if (!startDate && !endDate) {
    endDate = new Date()
    if (spanMs) {
      startDate = new Date(endDate.getTime() - spanMs)
    }
  } else if (endDate && !startDate) {
    if (spanMs) {
      startDate = new Date(endDate.getTime() - spanMs)
    }
  } else if (startDate && !endDate) {
    if (spanMs) {
      endDate = new Date(startDate.getTime() + spanMs)
    } else {
      endDate = new Date()
    }
  }
  return {
    interval,
    requestInterval,
    startDate,
    endDate,
    dataWindow,
    supportsInterval,
    allowedIntervals,
  }
}
