import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import { interpolateLogicalIndexFromTime } from '@/widgets/widgets/data_chart/plugins/core/utils/geometry'
import {
  cacheCanvas,
  createCacheCanvas,
  textWrap,
} from '@/widgets/widgets/data_chart/plugins/core/utils/text-helpers'

export const MINIMUM_BOX_PADDING_PIXELS = 5

export type InlineEditorTextFontOptions = {
  family?: string
  size?: number
  bold?: boolean
  italic?: boolean
  color?: string
}

export type InlineEditorTextBoxOptions = {
  scale?: number
  angle?: number
  maxHeight?: number
  alignment?: {
    horizontal?: string
    vertical?: string
  }
  padding?: {
    x?: number
    y?: number
  }
  border?: {
    color?: string
    width?: number
    style?: string | number
    radius?: number | Array<number | string>
  }
  background?: {
    color?: string
    inflation?: {
      x?: number
      y?: number
    }
  }
  shadow?: {
    color?: string
    blur?: number
    offset?: {
      x?: number
      y?: number
    }
  }
}

export type InlineEditorTextOptions = {
  value?: string
  padding?: number
  wordWrapWidth?: number | string
  forceCalculateMaxLineWidth?: boolean
  font?: InlineEditorTextFontOptions
  box?: InlineEditorTextBoxOptions
}

export type InlineEditorToolOptions = Record<string, unknown> & {
  text?: InlineEditorTextOptions
  editable?: boolean
  line?: {
    color?: unknown
  }
}

type BusinessDayLike = {
  year: number
  month: number
  day: number
}

const isCssColorLike = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('rgb(') ||
    normalized.startsWith('rgba(') ||
    normalized.startsWith('hsl(') ||
    normalized.startsWith('hsla(') ||
    normalized.startsWith('oklab(') ||
    normalized.startsWith('oklch(') ||
    normalized.startsWith('color(') ||
    normalized.startsWith('var(') ||
    normalized === 'transparent'
  )
}

const isBusinessDayLike = (value: unknown): value is BusinessDayLike => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<BusinessDayLike>
  return (
    typeof candidate.year === 'number' &&
    typeof candidate.month === 'number' &&
    typeof candidate.day === 'number'
  )
}

const toSecondsTimestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) > 1e12) {
      return value / 1000
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) {
      return null
    }
    return parsed / 1000
  }

  if (isBusinessDayLike(value)) {
    const utcMs = Date.UTC(value.year, value.month - 1, value.day)
    if (!Number.isFinite(utcMs)) {
      return null
    }
    return utcMs / 1000
  }

  return null
}

const isTimestampWithinSeriesBounds = (
  series: ISeriesApi<any>,
  timestampSeconds: number
): boolean => {
  const firstItem = series.dataByIndex(Number.MIN_SAFE_INTEGER, 1 as any) as {
    time?: unknown
  } | null
  const lastItem = series.dataByIndex(Number.MAX_SAFE_INTEGER, -1 as any) as {
    time?: unknown
  } | null

  const firstSeconds = toSecondsTimestamp(firstItem?.time)
  const lastSeconds = toSecondsTimestamp(lastItem?.time)
  if (firstSeconds === null || lastSeconds === null) {
    return false
  }

  return timestampSeconds >= firstSeconds && timestampSeconds <= lastSeconds
}

export const resolveCssBorderStyle = (borderStyle: unknown) => {
  if (typeof borderStyle === 'string') {
    const normalized = borderStyle.toLowerCase()
    if (normalized.includes('dot')) return 'dotted'
    if (normalized.includes('dash')) return 'dashed'
    if (normalized === 'none') return 'none'
  }

  const numericStyle = Number(borderStyle)
  if (Number.isFinite(numericStyle)) {
    if (numericStyle === 1 || numericStyle === 4) return 'dotted'
    if (numericStyle === 2 || numericStyle === 3) return 'dashed'
  }

  return 'solid'
}

export const resolveCssBorderRadius = (radius: unknown) => {
  if (typeof radius === 'number' && Number.isFinite(radius)) {
    return `${Math.max(0, radius)}px`
  }

  if (Array.isArray(radius) && radius.length > 0) {
    const resolved = radius
      .slice(0, 4)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => `${Math.max(0, value)}px`)
    if (resolved.length > 0) {
      return resolved.join(' ')
    }
  }

  return '4px'
}

export const resolveCssBoxShadow = (shadowOptions: unknown) => {
  if (!shadowOptions || typeof shadowOptions !== 'object') return 'none'

  const shadow = shadowOptions as {
    color?: unknown
    blur?: unknown
    offset?: { x?: unknown; y?: unknown } | undefined
  }

  if (typeof shadow.color !== 'string' || shadow.color.trim().length === 0) return 'none'

  const blur = Number(shadow.blur)
  const offsetX = Number(shadow.offset?.x)
  const offsetY = Number(shadow.offset?.y)
  const resolvedBlur = Number.isFinite(blur) ? Math.max(0, blur) : 0
  const resolvedOffsetX = Number.isFinite(offsetX) ? offsetX : 0
  const resolvedOffsetY = Number.isFinite(offsetY) ? offsetY : 0

  return `${resolvedOffsetX}px ${resolvedOffsetY}px ${resolvedBlur}px ${shadow.color}`
}

export const resolveThemeColorToken = (styles: CSSStyleDeclaration, tokenName: string): string => {
  const rawValue = styles.getPropertyValue(tokenName).trim()
  if (!rawValue) return ''
  if (isCssColorLike(rawValue)) return rawValue
  return `hsl(${rawValue})`
}

export const resolveAnchorXCoordinate = (
  chart: IChartApi,
  series: ISeriesApi<any>,
  timestamp: unknown
): number | null => {
  const normalizedTimestamp = toSecondsTimestamp(timestamp)
  if (normalizedTimestamp === null) {
    return null
  }

  const timeScale = chart.timeScale()
  const interpolatedLogicalIndex = interpolateLogicalIndexFromTime(
    chart as any,
    series as any,
    normalizedTimestamp as any
  )
  if (interpolatedLogicalIndex === null) {
    return null
  }

  let targetLogicalIndex = Number(interpolatedLogicalIndex)
  if (isTimestampWithinSeriesBounds(series, normalizedTimestamp)) {
    const nearestIndex = timeScale.timeToIndex(normalizedTimestamp as any, true)
    if (nearestIndex !== null && Number.isFinite(Number(nearestIndex))) {
      targetLogicalIndex = Number(nearestIndex)
    }
  }

  const coordinate = timeScale.logicalToCoordinate(targetLogicalIndex as any)
  return coordinate === null ? null : Number(coordinate)
}

export const resolveNonEmptyColor = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const normalized = candidate.trim()
    if (normalized.length > 0) return normalized
  }
  return ''
}

export const resolveScaledBorderWidth = (
  borderWidth: unknown,
  toolType: unknown,
  textScale: number
): number => {
  const parsedWidth = Number(borderWidth)
  const baseWidth = Number.isFinite(parsedWidth) ? Math.max(0, parsedWidth) : 0

  if (toolType === 'Callout') {
    return baseWidth * textScale
  }

  return baseWidth
}

export const resolveScaledBorderRadius = (borderRadius: unknown, textScale: number): unknown => {
  if (typeof borderRadius === 'number' && Number.isFinite(borderRadius)) {
    return Math.max(0, borderRadius) * textScale
  }

  if (Array.isArray(borderRadius)) {
    return borderRadius.map((value) => {
      const parsedValue = Number(value)
      return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) * textScale : value
    })
  }

  return borderRadius
}

export const resolveWrappedLinesMaxWidth = (
  value: string,
  font: string,
  scaledWrapWidth: number | string | undefined,
  maxAllowedWidth: number | null,
  forceCalculateMaxLineWidth: boolean
): number => {
  const lines = textWrap(value, font, scaledWrapWidth)
  createCacheCanvas()

  const context = cacheCanvas
  if (!context) return 0

  context.font = font
  let maxLineWidth = 0
  for (const line of lines) {
    maxLineWidth = Math.max(maxLineWidth, context.measureText(line).width)
  }

  if (maxAllowedWidth !== null && !forceCalculateMaxLineWidth) {
    return Math.min(maxLineWidth, maxAllowedWidth)
  }

  return maxLineWidth
}
