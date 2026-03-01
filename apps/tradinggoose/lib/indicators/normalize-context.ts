import type { FillOptionOverride } from '@/lib/indicators/normalize-indicator-code'
import type {
  NormalizedPineFill,
  NormalizedPineMarker,
  NormalizedPineOutput,
  NormalizedPinePlot,
  NormalizedPineSeries,
  NormalizedPineSignal,
  PineUnsupportedInfo,
  PineWarning,
  SeriesMarkerPosition,
  SeriesMarkerShape,
} from '@/lib/indicators/types'

const toSeconds = (ms: number) => Math.floor(ms / 1000)

const resolveColorAlpha = (color: string, alpha: number) => {
  const trimmed = color.trim()
  const boundedAlpha = Math.max(0, Math.min(1, alpha))
  const alphaHex = Math.round(boundedAlpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toLowerCase()

  const shortHex = trimmed.match(/^#([0-9a-fA-F]{3})$/)
  if (shortHex) {
    const [rHex, gHex, bHex] = shortHex[1]!.split('')
    return `#${rHex}${rHex}${gHex}${gHex}${bHex}${bHex}${alphaHex}`.toLowerCase()
  }

  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) {
    return `${trimmed}${alphaHex}`.toLowerCase()
  }

  if (/^#([0-9a-fA-F]{8})$/.test(trimmed)) {
    return `${trimmed.slice(0, 7)}${alphaHex}`.toLowerCase()
  }

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const parts = rgb[1]!.split(',').map((value) => value.trim())
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${boundedAlpha})`
    }
  }

  return color
}

const resolveStringOption = (options: Record<string, unknown> | undefined, keys: string[]) => {
  if (!options) return undefined
  for (const key of keys) {
    const value = options[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

const resolveOpacityAlpha = (raw: unknown) => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return Math.max(0, Math.min(1, raw))
}

const mapShape = (shape?: string): SeriesMarkerShape | null => {
  const value = shape?.toLowerCase()
  if (!value) return null
  if (value === 'arrowup') return 'arrowUp'
  if (value === 'arrowdown') return 'arrowDown'
  if (value === 'circle') return 'circle'
  if (value === 'square') return 'square'
  return null
}

const mapLocation = (location?: string): SeriesMarkerPosition | null => {
  const value = location?.toLowerCase()
  if (!value) return null
  if (value === 'abovebar') return 'aboveBar'
  if (value === 'belowbar') return 'belowBar'
  if (value === 'inbar') return 'inBar'
  if (value === 'absolute') return 'atPriceMiddle'
  return null
}

const resolveOffset = (
  pointOptions?: Record<string, unknown>,
  plotOptions?: Record<string, unknown>
) => {
  const raw = pointOptions?.offset ?? plotOptions?.offset
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) return 0
  return Math.trunc(raw)
}

const resolveTimeWithOffset = (
  timeMs: number,
  offset: number,
  indexByOpenTimeMs?: Map<number, number>,
  openTimeMsByIndex?: number[]
) => {
  if (!offset) return timeMs
  if (!indexByOpenTimeMs || !openTimeMsByIndex) return timeMs
  const currentIndex = indexByOpenTimeMs.get(timeMs)
  if (typeof currentIndex !== 'number') return timeMs
  const nextIndex = currentIndex + offset
  if (nextIndex < 0 || nextIndex >= openTimeMsByIndex.length) return null
  return openTimeMsByIndex[nextIndex]
}

const resolveMarkerText = (plot: { title?: string; options?: Record<string, unknown> }) => {
  const optionsText =
    typeof plot.options?.text === 'string' && plot.options.text.trim().length > 0
      ? plot.options.text.trim()
      : null
  if (optionsText) return optionsText
  const title = plot.title?.trim()
  return title
}

const resolvePlotColor = (options?: Record<string, unknown>) =>
  resolveStringOption(options, ['color'])

const resolveFillColors = ({
  sharedFillColor,
  upperFillColor,
  lowerFillColor,
  upperPlotColor,
  lowerPlotColor,
  opacityAlpha,
}: {
  sharedFillColor?: string
  upperFillColor?: string
  lowerFillColor?: string
  upperPlotColor?: string
  lowerPlotColor?: string
  opacityAlpha?: number
}) => {
  const topBase = upperFillColor ?? sharedFillColor ?? upperPlotColor ?? '#60a5fa'
  const bottomBase =
    lowerFillColor ?? sharedFillColor ?? lowerPlotColor ?? upperPlotColor ?? topBase
  const hasExplicitColor = Boolean(sharedFillColor || upperFillColor || lowerFillColor)

  if (typeof opacityAlpha === 'number') {
    return {
      topColor: resolveColorAlpha(topBase, opacityAlpha),
      bottomColor: resolveColorAlpha(bottomBase, opacityAlpha),
    }
  }

  if (hasExplicitColor) {
    return {
      topColor: topBase,
      bottomColor: bottomBase,
    }
  }

  return {
    topColor: resolveColorAlpha(topBase, 0.16),
    bottomColor: resolveColorAlpha(bottomBase, 0.16),
  }
}

const resolvePlotPoints = ({
  data,
  plotOptions,
  indexByOpenTimeMs,
  openTimeMsByIndex,
}: {
  data: any[]
  plotOptions?: Record<string, unknown>
  indexByOpenTimeMs?: Map<number, number>
  openTimeMsByIndex?: number[]
}): NormalizedPineSeries['points'] =>
  data
    .map((point: any) => {
      if (!point || typeof point !== 'object') return null
      const pointOptions = point.options ?? {}
      const offset = resolveOffset(pointOptions, plotOptions)
      const timeMs = resolveTimeWithOffset(
        Number(point.time),
        offset,
        indexByOpenTimeMs,
        openTimeMsByIndex
      )
      if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return null
      const mappedTime = toSeconds(timeMs)
      const rawValue =
        typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null

      const normalizedPoint: NormalizedPineSeries['points'][number] = {
        time: mappedTime,
        value: rawValue,
      }

      if (typeof pointOptions.color === 'string') {
        const color = pointOptions.color.trim()
        if (color.length > 0) {
          normalizedPoint.color = color
        }
      }

      return normalizedPoint
    })
    .filter((point: unknown): point is NormalizedPineSeries['points'][number] => Boolean(point))

const resolveSeriesStyle = (style?: string) => {
  const normalized = style ?? 'style_line'
  if (normalized === 'style_histogram') {
    return { seriesType: 'Histogram' as const, needsMarkers: false }
  }
  if (normalized === 'style_area') {
    return { seriesType: 'Area' as const, needsMarkers: false }
  }
  if (normalized.startsWith('style_stepline')) {
    return { seriesType: 'Line' as const, needsMarkers: false, lineType: 'withSteps' }
  }
  if (normalized === 'style_circles') {
    return { seriesType: undefined, needsMarkers: true }
  }
  if (normalized === 'style_line') {
    return { seriesType: 'Line' as const, needsMarkers: false }
  }
  return { seriesType: 'Line' as const, needsMarkers: false }
}

export function normalizeContext({
  context,
  indexByOpenTimeMs,
  openTimeMsByIndex,
  triggerSignals = [],
  fillOptionOverrides = [],
}: {
  context: any
  indexByOpenTimeMs?: Map<number, number>
  openTimeMsByIndex?: number[]
  triggerSignals?: NormalizedPineSignal[]
  fillOptionOverrides?: FillOptionOverride[]
}): { output: NormalizedPineOutput; warnings: PineWarning[] } {
  const warnings: PineWarning[] = []
  const unsupported: PineUnsupportedInfo = { plots: [], styles: [] }
  const series: NormalizedPineSeries[] = []
  const fills: NormalizedPineFill[] = []
  const markers: NormalizedPineMarker[] = []

  const plots = context?.plots && typeof context.plots === 'object' ? context.plots : {}
  let fillOverrideCursor = 0

  Object.entries(plots).forEach(([title, plot]) => {
    if (!plot || typeof plot !== 'object') return
    const plotOptions = (plot as any).options ?? {}
    const style = plotOptions.style as string | undefined
    const overlay = Boolean(
      plotOptions.overlay ?? plotOptions.force_overlay ?? context?.indicator?.overlay ?? false
    )
    const plotColor = resolvePlotColor(plotOptions)

    if (style === 'shape' || style === 'char') {
      const fallbackText = resolveMarkerText({ title, options: plotOptions })
      if (style === 'char') {
        warnings.push({
          code: 'plotchar_text_fallback',
          message:
            'plotchar does not persist per-point text in PineTS v0.8.x; using fallback text.',
        })
      }
      const plotShape = mapShape(plotOptions.shape as string | undefined) ?? 'circle'
      const plotLocation = mapLocation(plotOptions.location as string | undefined) ?? 'aboveBar'

      const data = Array.isArray((plot as any).data) ? (plot as any).data : []
      data.forEach((point: any) => {
        if (!point || typeof point !== 'object') return
        const pointOptions = point.options ?? {}
        const offset = resolveOffset(pointOptions, plotOptions)
        const timeMs = resolveTimeWithOffset(
          Number(point.time),
          offset,
          indexByOpenTimeMs,
          openTimeMsByIndex
        )
        if (!Number.isFinite(timeMs ?? Number.NaN)) return
        const mappedTime = toSeconds(timeMs as number)

        const rawShape = mapShape(pointOptions.shape as string | undefined) ?? plotShape ?? 'circle'
        const rawLocation = mapLocation(pointOptions.location as string | undefined) ?? plotLocation
        if (!rawShape || !rawLocation) return

        const marker: NormalizedPineMarker = {
          time: mappedTime,
          position: rawLocation,
          shape: rawShape,
          color:
            typeof pointOptions.color === 'string' && pointOptions.color.trim().length > 0
              ? pointOptions.color.trim()
              : plotColor,
          text:
            typeof pointOptions.text === 'string' && pointOptions.text.trim().length > 0
              ? pointOptions.text.trim()
              : fallbackText,
        }

        if (
          marker.position === 'atPriceTop' ||
          marker.position === 'atPriceBottom' ||
          marker.position === 'atPriceMiddle'
        ) {
          const numericValue = Number(point.value)
          if (!Number.isFinite(numericValue)) return
          marker.price = numericValue
        }

        markers.push(marker)
      })
      return
    }

    if (style === 'bar' || style === 'candle') {
      unsupported.styles.push(style)
      unsupported.plots.push(title)
      warnings.push({
        code: 'unsupported_plot_style',
        message: `${title} uses ${style}, which is not supported in v0.2.`,
      })
      return
    }

    if (style === 'fill') {
      const fillOverride = fillOptionOverrides[fillOverrideCursor]
      fillOverrideCursor += 1
      const fillPlot1 =
        typeof (plot as any).plot1 === 'string' ? ((plot as any).plot1 as string) : ''
      const fillPlot2 =
        typeof (plot as any).plot2 === 'string' ? ((plot as any).plot2 as string) : ''
      const upperPlot = fillPlot1 ? (plots as Record<string, any>)[fillPlot1] : null
      const lowerPlot = fillPlot2 ? (plots as Record<string, any>)[fillPlot2] : null
      const upperOptions = upperPlot?.options ?? {}
      const lowerOptions = lowerPlot?.options ?? {}
      const upperPlotColor = resolvePlotColor(upperOptions)
      const lowerPlotColor = resolvePlotColor(lowerOptions)
      const fillUpperColor = fillOverride?.upperColor
      const fillLowerColor = fillOverride?.lowerColor
      const fillOpacityAlpha = resolveOpacityAlpha(fillOverride?.opacity)
      const upperData = Array.isArray(upperPlot?.data) ? upperPlot.data : []
      const lowerData = Array.isArray(lowerPlot?.data) ? lowerPlot.data : []

      if (upperData.length === 0 || lowerData.length === 0) {
        warnings.push({
          code: 'fill_reference_missing',
          message: `${title || 'fill'} could not resolve source plots "${fillPlot1 || 'plot1'}" and "${fillPlot2 || 'plot2'}".`,
        })
        return
      }

      const fillTitle =
        typeof (plot as any).title === 'string' && (plot as any).title.trim().length > 0
          ? (plot as any).title.trim()
          : `${fillPlot1 || 'plot1'}:${fillPlot2 || 'plot2'}:fill`
      const fillOverlay = Boolean(
        upperOptions.overlay ??
          upperOptions.force_overlay ??
          lowerOptions.overlay ??
          lowerOptions.force_overlay ??
          overlay
      )

      const upperPoints = resolvePlotPoints({
        data: upperData,
        plotOptions: upperOptions,
        indexByOpenTimeMs,
        openTimeMsByIndex,
      })
      const lowerPoints = resolvePlotPoints({
        data: lowerData,
        plotOptions: lowerOptions,
        indexByOpenTimeMs,
        openTimeMsByIndex,
      })
      const lowerByTime = new Map<number, number>()
      lowerPoints.forEach((point) => {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return
        lowerByTime.set(point.time, point.value)
      })

      const fillPoints: NormalizedPineFill['points'] = []
      upperPoints.forEach((point) => {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return
        const lowerValue = lowerByTime.get(point.time)
        if (typeof lowerValue !== 'number' || !Number.isFinite(lowerValue)) return
        fillPoints.push({
          time: point.time,
          upper: point.value,
          lower: lowerValue,
        })
      })

      if (fillPoints.length < 2) {
        warnings.push({
          code: 'fill_insufficient_points',
          message: `${fillTitle} has insufficient points after alignment and will be skipped.`,
        })
        return
      }

      const fillColors = resolveFillColors({
        sharedFillColor: plotColor,
        upperFillColor: fillUpperColor,
        lowerFillColor: fillLowerColor,
        upperPlotColor,
        lowerPlotColor,
        opacityAlpha: fillOpacityAlpha,
      })

      fills.push({
        title: fillTitle,
        overlay: fillOverlay,
        upperPlotTitle: fillPlot1 || undefined,
        lowerPlotTitle: fillPlot2 || undefined,
        topColor: fillColors.topColor,
        bottomColor: fillColors.bottomColor,
        points: fillPoints,
      })
      return
    }

    if (style === 'background' || style === 'barcolor') {
      unsupported.styles.push(style)
      unsupported.plots.push(title)
      warnings.push({
        code: 'unsupported_plot_style',
        message: `${title} uses ${style}, which is not supported in v0.2.`,
      })
      return
    }

    const data = Array.isArray((plot as any).data) ? (plot as any).data : []
    const resolvedStyle = resolveSeriesStyle(style)
    const seriesOptions: Record<string, unknown> = {}

    if (resolvedStyle.lineType) {
      seriesOptions.lineType = resolvedStyle.lineType
    }
    if (typeof plotOptions.linewidth === 'number' && Number.isFinite(plotOptions.linewidth)) {
      seriesOptions.lineWidth = plotOptions.linewidth
    }

    if (resolvedStyle.seriesType === 'Line' && plotColor) {
      seriesOptions.color = plotColor
    }
    if (resolvedStyle.seriesType === 'Histogram' && plotColor) {
      seriesOptions.color = plotColor
    }
    if (resolvedStyle.seriesType === 'Area' && plotColor) {
      seriesOptions.lineColor = plotColor
      seriesOptions.topColor = resolveColorAlpha(plotColor, 0.4)
      seriesOptions.bottomColor = resolveColorAlpha(plotColor, 0)
    }

    const plotDescriptor: NormalizedPinePlot = {
      title,
      overlay,
      style,
      seriesType: resolvedStyle.seriesType,
      color: plotColor,
      options: Object.keys(seriesOptions).length > 0 ? seriesOptions : undefined,
    }

    const points = resolvePlotPoints({
      data,
      plotOptions,
      indexByOpenTimeMs,
      openTimeMsByIndex,
    })

    if (resolvedStyle.needsMarkers) {
      if (style === 'style_cross') {
        warnings.push({
          code: 'style_cross_fallback',
          message: `${title} uses style_cross; falling back to circle markers.`,
        })
      } else if (style === 'style_circles') {
        warnings.push({
          code: 'style_circles_fallback',
          message: `${title} uses style_circles; rendering circle markers only.`,
        })
      }

      points.forEach((point: NormalizedPineSeries['points'][number]) => {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return
        markers.push({
          time: point.time,
          position: 'atPriceMiddle',
          shape: 'circle',
          color: point.color ?? plotColor,
          text: resolveMarkerText({ title, options: plotOptions }),
          price: point.value,
        })
      })
    }

    if (resolvedStyle.seriesType) {
      series.push({ plot: plotDescriptor, points })
    }
  })

  triggerSignals.forEach((signal) => {
    const shape: SeriesMarkerShape =
      signal.signal === 'long' ? 'arrowUp' : signal.signal === 'short' ? 'arrowDown' : 'circle'
    markers.push({
      source: 'trigger',
      time: signal.time,
      position: signal.position,
      shape,
      color: signal.color ?? (signal.signal === 'flat' ? '#ffab00' : undefined),
      text: signal.event,
    })
  })

  return {
    output: {
      series,
      fills,
      markers,
      triggers: triggerSignals,
      unsupported,
    },
    warnings,
  }
}
