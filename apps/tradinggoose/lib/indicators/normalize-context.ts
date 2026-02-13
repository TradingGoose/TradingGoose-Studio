import type {
  NormalizedPineMarker,
  NormalizedPineOutput,
  NormalizedPinePlot,
  NormalizedPineSeries,
  PineWarning,
  PineUnsupportedInfo,
  SeriesMarkerPosition,
  SeriesMarkerShape,
} from '@/lib/indicators/types'

const toSeconds = (ms: number) => Math.floor(ms / 1000)

const resolveHexAlpha = (color: string, alpha: number) => {
  const trimmed = color.trim()
  if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return color
  const r = Number.parseInt(trimmed.slice(1, 3), 16)
  const g = Number.parseInt(trimmed.slice(3, 5), 16)
  const b = Number.parseInt(trimmed.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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

const resolveOffset = (pointOptions?: Record<string, unknown>, plotOptions?: Record<string, unknown>) => {
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
}: {
  context: any
  indexByOpenTimeMs?: Map<number, number>
  openTimeMsByIndex?: number[]
}): { output: NormalizedPineOutput; warnings: PineWarning[] } {
  const warnings: PineWarning[] = []
  const unsupported: PineUnsupportedInfo = { plots: [], styles: [] }
  const series: NormalizedPineSeries[] = []
  const markers: NormalizedPineMarker[] = []

  const plots = context?.plots && typeof context.plots === 'object' ? context.plots : {}

  Object.entries(plots).forEach(([title, plot]) => {
    if (!plot || typeof plot !== 'object') return
    const plotOptions = (plot as any).options ?? {}
    const style = plotOptions.style as string | undefined
    const overlay = Boolean(
      plotOptions.overlay ?? plotOptions.force_overlay ?? context?.indicator?.overlay ?? false
    )
    const plotColor =
      typeof plotOptions.color === 'string' && plotOptions.color.trim().length > 0
        ? plotOptions.color.trim()
        : undefined

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
      const plotLocation =
        mapLocation(plotOptions.location as string | undefined) ?? 'aboveBar'

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
        if (!Number.isFinite(timeMs ?? NaN)) return
        const mappedTime = toSeconds(timeMs as number)

        const rawShape =
          mapShape(pointOptions.shape as string | undefined) ?? plotShape ?? 'circle'
        const rawLocation =
          mapLocation(pointOptions.location as string | undefined) ?? plotLocation
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

    if (style === 'background' || style === 'barcolor' || style === 'fill') {
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
      seriesOptions.topColor = resolveHexAlpha(plotColor, 0.4)
      seriesOptions.bottomColor = resolveHexAlpha(plotColor, 0)
    }

    const plotDescriptor: NormalizedPinePlot = {
      title,
      overlay,
      style,
      seriesType: resolvedStyle.seriesType,
      color: plotColor,
      options: Object.keys(seriesOptions).length > 0 ? seriesOptions : undefined,
    }

    const points = data
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
        if (!Number.isFinite(timeMs ?? NaN)) return null
        const mappedTime = toSeconds(timeMs as number)
        const rawValue =
          typeof point.value === 'number' && Number.isFinite(point.value)
            ? point.value
            : null

        return {
          time: mappedTime,
          value: rawValue,
          color:
            typeof pointOptions.color === 'string' && pointOptions.color.trim().length > 0
              ? pointOptions.color.trim()
              : undefined,
        }
      })
      .filter(
        (point: unknown): point is NormalizedPineSeries['points'][number] => Boolean(point)
      )

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

  return {
    output: {
      series,
      markers,
      signals: [],
      unsupported,
    },
    warnings,
  }
}
