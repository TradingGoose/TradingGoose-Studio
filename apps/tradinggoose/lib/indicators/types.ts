export type InputMeta = {
  title: string
  type?: string
  defval?: unknown
  minval?: number
  maxval?: number
  step?: number
  options?: unknown[]
  value?: unknown
}

export type InputMetaMap = Record<string, InputMeta>

export type PineUnsupportedInfo = {
  plots: string[]
  styles: string[]
}

export type PineWarning = {
  code: string
  message: string
}

export type IndicatorOptions = {
  overlay?: boolean
  format?: string
  precision?: number
  scale?: string
  max_bars_back?: number
  timeframe?: string
  timeframe_gaps?: boolean
  explicit_plot_zorder?: boolean
  max_lines_count?: number
  max_labels_count?: number
  max_boxes_count?: number
  max_polylines_count?: number
  calc_bars_count?: number
  dynamic_requests?: boolean
  behind_chart?: boolean
}

export type NormalizedPinePlot = {
  title: string
  overlay: boolean
  style?: string
  seriesType?: 'Line' | 'Area' | 'Histogram'
  color?: string
  options?: Record<string, unknown>
}

export type NormalizedPineSeriesPoint = {
  time: number
  value: number | null
  color?: string
}

export type NormalizedPineSeries = {
  plot: NormalizedPinePlot
  points: NormalizedPineSeriesPoint[]
}

export type NormalizedPineFillPoint = {
  time: number
  upper: number
  lower: number
}

export type NormalizedPineFill = {
  title: string
  overlay: boolean
  upperPlotTitle?: string
  lowerPlotTitle?: string
  topColor: string
  bottomColor: string
  points: NormalizedPineFillPoint[]
}

export type SeriesMarkerPosition =
  | 'aboveBar'
  | 'belowBar'
  | 'inBar'
  | 'atPriceTop'
  | 'atPriceBottom'
  | 'atPriceMiddle'

export type SeriesMarkerShape = 'circle' | 'square' | 'arrowUp' | 'arrowDown'

export type NormalizedPineMarker = {
  time: number
  position: SeriesMarkerPosition
  shape: SeriesMarkerShape
  source?: 'trigger'
  color?: string
  text?: string
  price?: number
}

export type IndicatorTriggerSignal = 'long' | 'short' | 'flat'

export type NormalizedPineSignal = {
  event: string
  input: string
  signal: IndicatorTriggerSignal
  time: number
  barIndex: number
  position: SeriesMarkerPosition
  color?: string
}

export type NormalizedPineOutput = {
  series: NormalizedPineSeries[]
  fills: NormalizedPineFill[]
  markers: NormalizedPineMarker[]
  triggers: NormalizedPineSignal[]
  unsupported: PineUnsupportedInfo
  indicator?: IndicatorOptions
}

export type BarMs = {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}
