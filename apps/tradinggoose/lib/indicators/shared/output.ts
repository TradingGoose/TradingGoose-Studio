export type IndicatorSignal = {
  type: 'buy' | 'sell'
  data: Array<number | null>
  text?: string
  color?: string
  textData?: Array<string | null>
}

export type IndicatorPlot = {
  key?: string
  name?: string
  data?: unknown[]
  color?: string
  type?: string
  overlay?: boolean
  style?: string
}

export type IndicatorOutput = {
  name?: string
  plots?: IndicatorPlot[] | Record<string, unknown[]>
  signals?: Array<Partial<IndicatorSignal> & { data?: unknown[]; textData?: unknown[] }>
}

export type NormalizedPlot = {
  key: string
  title: string
  type: string
  color?: string
  overlay: boolean
  style?: string
  data: Array<number | null>
}

export type NormalizedIndicatorOutput = {
  name?: string
  plots: NormalizedPlot[]
  signals: IndicatorSignal[]
  allOverlay: boolean
  plotSignature: string
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const normalizeSignals = (
  signals: IndicatorOutput['signals'],
  length: number
): IndicatorSignal[] => {
  if (!Array.isArray(signals) || length === 0) return []

  return signals
    .map((signal) => {
      const typeRaw = typeof signal?.type === 'string' ? signal.type.toLowerCase() : ''
      const type = typeRaw === 'sell' ? 'sell' : typeRaw === 'buy' ? 'buy' : null
      if (!type) return null

      const data = Array.isArray(signal?.data) ? signal.data : []
      const normalizedData: Array<number | null> = Array.from({ length }, (_value, i) =>
        toNumberOrNull(i < data.length ? data[i] : null)
      )

      const textData = Array.isArray(signal?.textData)
        ? signal.textData.map((value, i) => {
            if (i >= length) return null
            return typeof value === 'string' ? value : null
          })
        : undefined

      return {
        type,
        data: normalizedData,
        text: typeof signal?.text === 'string' ? signal.text : undefined,
        color: typeof signal?.color === 'string' ? signal.color : undefined,
        textData,
      } as IndicatorSignal
    })
    .filter((signal): signal is IndicatorSignal => Boolean(signal))
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const ensureUniqueKey = (base: string, used: Set<string>): string => {
  let key = base
  let suffix = 2
  while (used.has(key)) {
    key = `${base}_${suffix}`
    suffix += 1
  }
  used.add(key)
  return key
}

const normalizePlots = (plots: IndicatorPlot[] | undefined, length: number): NormalizedPlot[] => {
  if (!Array.isArray(plots) || plots.length === 0) return []

  const usedKeys = new Set<string>()

  return plots.map((plot, index) => {
    const record = plot && typeof plot === 'object' ? plot : {}
    const rawKey = typeof record.key === 'string' ? record.key.trim() : ''
    const rawName = typeof record.name === 'string' ? record.name.trim() : ''
    const title = rawName || rawKey || `Plot ${index + 1}`
    const baseKey = rawKey || slugify(title) || `plot_${index + 1}`
    const key = ensureUniqueKey(baseKey, usedKeys)
    const type =
      typeof record.type === 'string' && record.type.trim().length > 0
        ? record.type.trim()
        : 'line'
    const color = typeof record.color === 'string' && record.color.trim().length > 0 ? record.color.trim() : undefined
    const overlay = record.overlay !== false
    const style =
      typeof record.style === 'string' && record.style.trim().length > 0
        ? record.style.trim()
        : undefined
    const data = Array.isArray(record.data) ? record.data : []
    const normalizedData: Array<number | null> = Array.from({ length }, (_value, i) =>
      toNumberOrNull(i < data.length ? data[i] : null)
    )

    return {
      key,
      title,
      type,
      color,
      overlay,
      style,
      data: normalizedData,
    }
  })
}

export const normalizeIndicatorOutput = (
  rawResult: unknown,
  length: number
): NormalizedIndicatorOutput => {
  let resolvedResult: unknown = rawResult
  if (typeof resolvedResult === 'string') {
    try {
      resolvedResult = JSON.parse(resolvedResult)
    } catch {
      resolvedResult = {}
    }
  }

  const output = (resolvedResult && typeof resolvedResult === 'object'
    ? (resolvedResult as IndicatorOutput)
    : {}) satisfies IndicatorOutput

  const rawPlots = Array.isArray(output.plots)
    ? output.plots
    : output.plots && typeof output.plots === 'object'
      ? Object.entries(output.plots as Record<string, unknown[]>).map(([key, data]) => ({
          key,
          data,
        }))
      : []
  const plots = normalizePlots(rawPlots, length)
  const signals = normalizeSignals(output.signals, length)
  const allOverlay = plots.length > 0 ? plots.every((plot) => plot.overlay) : false
  const plotSignature = plots
    .map((plot) =>
      `${plot.key}:${plot.type}:${plot.overlay ? '1' : '0'}:${plot.color ?? ''}:${plot.style ?? ''}`
    )
    .join('|')

  return {
    name: typeof output.name === 'string' ? output.name : undefined,
    plots,
    signals,
    allOverlay,
    plotSignature,
  }
}

export const buildPlotRows = (plots: NormalizedPlot[], length: number) => {
  if (plots.length === 0 || length === 0) return [] as Array<Record<string, number | null>>

  const rows: Array<Record<string, number | null>> = Array.from({ length }, () => ({}))

  plots.forEach((plot) => {
    for (let i = 0; i < length; i += 1) {
      rows[i][plot.key] = plot.data[i] ?? null
    }
  })

  return rows
}

export const buildFigureStyles = (plot: { color?: string; style?: string }) => {
  if (!plot.color && !plot.style) return undefined
  return () => {
    const styles: Record<string, unknown> = {}
    if (plot.color) {
      styles.color = plot.color
    }
    if (plot.style) {
      styles.style = plot.style
    }
    return styles
  }
}
