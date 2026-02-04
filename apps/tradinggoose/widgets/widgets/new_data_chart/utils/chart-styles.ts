import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  PriceScaleMode,
  TickMarkType,
  type Time,
} from 'lightweight-charts'
import { isUtcOffset, parseUtcOffsetMinutes } from '@/lib/time-format'
import type { DataChartCandleType, DataChartViewParams } from '@/widgets/widgets/new_data_chart/types'

export const DEFAULT_RIGHT_OFFSET = 50
export const DEFAULT_UP_COLOR = '#089981'
export const DEFAULT_DOWN_COLOR = '#F23645'

const DEFAULT_CANDLE_TYPE: DataChartCandleType = 'candle_solid'

type TimeFormatterConfig = {
  locale?: string
  timezone: string
}

type StyleOverrides = Record<string, unknown>

const toUtcDate = (time: Time): Date | null => {
  if (typeof time === 'number') {
    return new Date(time * 1000)
  }
  if (typeof time === 'string') {
    return new Date(`${time}T00:00:00Z`)
  }
  if (typeof time === 'object' && time && 'year' in time) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day))
  }
  return null
}

const buildFormatter = (
  locale: string | undefined,
  timezone: string,
  options: Intl.DateTimeFormatOptions
) => {
  const normalizedLocale = locale?.trim() || undefined
  const normalizedTimezone = timezone.trim() || 'UTC'
  try {
    return new Intl.DateTimeFormat(normalizedLocale, {
      ...options,
      timeZone: normalizedTimezone,
    })
  } catch {
    return new Intl.DateTimeFormat(normalizedLocale, {
      ...options,
      timeZone: 'UTC',
    })
  }
}

const applyOffset = (date: Date, timezone: string) => {
  if (!isUtcOffset(timezone)) return date
  const offsetMinutes = parseUtcOffsetMinutes(timezone)
  return new Date(date.getTime() + offsetMinutes * 60_000)
}

export const formatLwcTime = (
  time: Time,
  timezone: string,
  locale?: string
): string => {
  const date = toUtcDate(time)
  if (!date) return ''
  const resolvedTimezone = timezone.trim() || 'UTC'
  const hasTime = typeof time === 'number'
  const adjustedDate = applyOffset(date, resolvedTimezone)
  const showSeconds = hasTime && adjustedDate.getUTCSeconds() !== 0
  const options: Intl.DateTimeFormatOptions = hasTime
    ? {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(showSeconds ? { second: '2-digit' } : null),
    }
    : {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }

  const formatter = buildFormatter(
    locale,
    isUtcOffset(resolvedTimezone) ? 'UTC' : resolvedTimezone,
    options
  )
  return formatter.format(adjustedDate)
}

export const formatLwcTick = (
  time: Time,
  tickType: TickMarkType,
  timezone: string,
  locale?: string
): string => {
  const date = toUtcDate(time)
  if (!date) return ''
  const resolvedTimezone = timezone.trim() || 'UTC'
  const adjustedDate = applyOffset(date, resolvedTimezone)
  const options: Intl.DateTimeFormatOptions = {}

  switch (tickType) {
    case TickMarkType.Year:
      options.year = 'numeric'
      break
    case TickMarkType.Month:
      options.month = 'short'
      break
    case TickMarkType.DayOfMonth:
      options.month = 'short'
      options.day = 'numeric'
      break
    case TickMarkType.Time:
      options.hour = '2-digit'
      options.minute = '2-digit'
      options.hour12 = false
      break
    case TickMarkType.TimeWithSeconds:
      options.hour = '2-digit'
      options.minute = '2-digit'
      options.second = '2-digit'
      options.hour12 = false
      break
    default:
      options.month = 'short'
      options.day = 'numeric'
      break
  }

  const formatter = buildFormatter(
    locale,
    isUtcOffset(resolvedTimezone) ? 'UTC' : resolvedTimezone,
    options
  )
  return formatter.format(adjustedDate)
}

export const resolveCandleType = (
  candleType?: DataChartCandleType | string | null
): DataChartCandleType => {
  if (!candleType) return DEFAULT_CANDLE_TYPE
  return candleType as DataChartCandleType
}

export const resolvePriceScaleMode = (
  axisType?: DataChartViewParams['priceAxisType']
): PriceScaleMode => {
  if (axisType === 'percentage') return PriceScaleMode.Percentage
  if (axisType === 'log') return PriceScaleMode.Logarithmic
  return PriceScaleMode.Normal
}

export const buildSeriesOptions = (
  candleType: DataChartCandleType,
  priceFormat?: { precision: number; minMove: number }
) => {
  const commonPriceFormat = priceFormat
    ? { priceFormat: { type: 'price' as const, ...priceFormat } }
    : {}

  if (candleType === 'ohlc') {
    return {
      seriesType: BarSeries,
      options: {
        upColor: DEFAULT_UP_COLOR,
        downColor: DEFAULT_DOWN_COLOR,
        thinBars: false,
        ...commonPriceFormat,
      },
    }
  }

  if (candleType === 'area') {
    return {
      seriesType: AreaSeries,
      options: {
        topColor: '#ffab0070',
        bottomColor: '#ffab0000',
        lineColor: '#ffab00',
        lineWidth: 2,
        ...commonPriceFormat,
      },
    }
  }

  const baseOptions = {
    upColor: DEFAULT_UP_COLOR,
    downColor: DEFAULT_DOWN_COLOR,
    borderUpColor: DEFAULT_UP_COLOR,
    borderDownColor: DEFAULT_DOWN_COLOR,
    wickUpColor: DEFAULT_UP_COLOR,
    wickDownColor: DEFAULT_DOWN_COLOR,
    borderVisible: false,
    ...commonPriceFormat,
  }

  if (candleType === 'candle_stroke') {
    return {
      seriesType: CandlestickSeries,
      options: {
        ...baseOptions,
        upColor: 'transparent',
        downColor: 'transparent',
        borderVisible: true,
      },
    }
  }

  if (candleType === 'candle_up_stroke') {
    return {
      seriesType: CandlestickSeries,
      options: {
        ...baseOptions,
        upColor: 'transparent',
        borderVisible: true,
      },
    }
  }

  if (candleType === 'candle_down_stroke') {
    return {
      seriesType: CandlestickSeries,
      options: {
        ...baseOptions,
        downColor: 'transparent',
        borderVisible: true,
      },
    }
  }

  return {
    seriesType: CandlestickSeries,
    options: baseOptions,
  }
}

export const resolveTimezone = (view?: DataChartViewParams, seriesTimezone?: string | null) => {
  const explicitTimezone = typeof view?.timezone === 'string' ? view.timezone.trim() : ''
  const exchangeTimezone = typeof seriesTimezone === 'string' ? seriesTimezone.trim() : ''
  return explicitTimezone || exchangeTimezone || 'UTC'
}

export const resolveLocale = (view?: DataChartViewParams) => {
  const locale = typeof view?.locale === 'string' ? view.locale.trim() : ''
  return locale || undefined
}

const ALLOWED_STYLE_OVERRIDE_KEYS = new Set([
  'layout',
  'grid',
  'crosshair',
  'rightPriceScale',
  'leftPriceScale',
  'timeScale',
  'localization',
])

export const sanitizeStyleOverrides = (
  stylesOverride?: StyleOverrides,
  onWarning?: (message: string) => void
) => {
  if (!stylesOverride || typeof stylesOverride !== 'object') return {}
  const sanitized: Record<string, unknown> = {}
  const entries = Object.entries(stylesOverride)

  entries.forEach(([key, value]) => {
    if (!ALLOWED_STYLE_OVERRIDE_KEYS.has(key)) {
      onWarning?.(`new_data_chart ignored unsupported style override: ${key}`)
      return
    }
    sanitized[key] = value
  })

  if (sanitized.localization && typeof sanitized.localization === 'object') {
    const localization = { ...(sanitized.localization as Record<string, unknown>) }
    if ('timeFormatter' in localization) {
      onWarning?.('new_data_chart ignores localization.timeFormatter overrides')
      delete localization.timeFormatter
    }
    sanitized.localization = localization
  }

  if (sanitized.timeScale && typeof sanitized.timeScale === 'object') {
    const timeScale = { ...(sanitized.timeScale as Record<string, unknown>) }
    if ('tickMarkFormatter' in timeScale) {
      onWarning?.('new_data_chart ignores timeScale.tickMarkFormatter overrides')
      delete timeScale.tickMarkFormatter
    }
    sanitized.timeScale = timeScale
  }

  return sanitized
}

export const buildTimeFormatterConfig = (
  view: DataChartViewParams | undefined,
  seriesTimezone: string | null
): TimeFormatterConfig => {
  const timezone = resolveTimezone(view, seriesTimezone)
  const locale = resolveLocale(view)
  return { timezone, locale }
}
