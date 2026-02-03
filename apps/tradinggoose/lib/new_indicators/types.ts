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
  color?: string
  text?: string
  price?: number
}

export type NormalizedPineOutput = {
  series: NormalizedPineSeries[]
  markers: NormalizedPineMarker[]
  drawings: unknown[]
  signals: unknown[]
  unsupported: PineUnsupportedInfo
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

