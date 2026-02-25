import {
  coerceMarketProviderParamValue,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import { rangeToMs as resolveRangeMs, seriesWindowKey } from '@/providers/market/series-window'
import {
  MARKET_INTERVALS,
  type MarketInterval,
  type MarketSeriesRange,
  type MarketSeriesWindow,
  type MarketSeriesWindowMode,
  type NormalizationMode,
} from '@/providers/market/types'
import {
  DEFAULT_BAR_COUNT,
  DEFAULT_RANGE_PRESETS,
  intervalToMs,
} from '@/widgets/widgets/data_chart/series-data'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

export const rangeToMs = (range?: MarketSeriesRange) => resolveRangeMs(range)

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

const normalizeInterval = (
  interval: MarketInterval | string | undefined,
  allowedIntervals: MarketInterval[]
) => {
  if (!interval) return undefined
  if (!allowedIntervals.length) return interval
  return allowedIntervals.includes(interval as MarketInterval) ? interval : undefined
}

const resolveDefaultInterval = (allowedIntervals: MarketInterval[]) => {
  if (!allowedIntervals.length) return undefined
  return allowedIntervals.includes('1d' as MarketInterval) ? '1d' : allowedIntervals[0]
}

const resolveDefaultWindow = (
  allowedModes: MarketSeriesWindowMode[],
  fallbackRange?: MarketSeriesRange
): MarketSeriesWindow | null => {
  if (allowedModes.includes('range') && fallbackRange) {
    return { mode: 'range', range: fallbackRange }
  }
  if (allowedModes.includes('bars')) {
    return { mode: 'bars', barCount: DEFAULT_BAR_COUNT }
  }
  if (allowedModes.includes('absolute') && fallbackRange) {
    const spanMs = rangeToMs(fallbackRange)
    if (!spanMs || spanMs <= 0) return null
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - spanMs)
    return {
      mode: 'absolute',
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    }
  }
  return null
}

export const resolveSeriesWindow = (params: DataChartWidgetParams, providerId?: string | null) => {
  const capabilities = providerId ? getMarketSeriesCapabilities(providerId) : null
  const supportsInterval = capabilities?.supportsInterval !== false
  const allowedIntervals = capabilities?.intervals?.length
    ? capabilities.intervals
    : [...MARKET_INTERVALS]
  const allowedWindowModes =
    capabilities?.windowModes && capabilities.windowModes.length > 0
      ? capabilities.windowModes
      : (['range'] as MarketSeriesWindowMode[])

  const viewParams = params.view ?? {}
  const fallbackRange = DEFAULT_RANGE_PRESETS[0]?.range
  const rangePresetId =
    typeof viewParams.rangePresetId === 'string' ? viewParams.rangePresetId.trim() : ''
  const rangePreset = rangePresetId
    ? (DEFAULT_RANGE_PRESETS.find((preset) => preset.id === rangePresetId) ?? null)
    : null

  let window: MarketSeriesWindow | null = null
  if (rangePreset && allowedWindowModes.includes('range')) {
    window = { mode: 'range', range: rangePreset.range }
  } else if (allowedWindowModes.includes('bars')) {
    window = { mode: 'bars', barCount: DEFAULT_BAR_COUNT }
  } else {
    window = resolveDefaultWindow(allowedWindowModes, fallbackRange)
  }

  const viewInterval = normalizeInterval(viewParams.interval, allowedIntervals)
  let interval = viewInterval
  if (!interval && window && window.mode === 'range') {
    const rangeMs = rangeToMs(window.range)
    interval = rangeMs ? chooseIntervalForRange(rangeMs, allowedIntervals) : undefined
  }
  if (!interval) {
    interval = resolveDefaultInterval(allowedIntervals)
  }

  const requestInterval = supportsInterval ? interval : undefined
  const windows: MarketSeriesWindow[] = []
  if (window) {
    if (window.mode === 'absolute') {
      windows.push({ mode: 'absolute', start: window.start, end: window.end })
    } else if (window.mode === 'range') {
      windows.push({ mode: 'range', range: window.range })
    } else {
      windows.push({ mode: 'bars', barCount: window.barCount })
    }
  }
  const windowKey = seriesWindowKey(windows)

  return {
    interval,
    requestInterval,
    window,
    fallbackWindow: null,
    windows,
    windowKey,
    supportsInterval,
    allowedIntervals,
  }
}
