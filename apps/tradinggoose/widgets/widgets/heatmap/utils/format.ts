export const formatHeatmapPrice = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return value >= 100 ? value.toFixed(2) : value.toPrecision(4)
}

export const formatHeatmapPercent = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export const formatHeatmapChange = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `${value >= 0 ? '+' : '-'}${formatHeatmapPrice(Math.abs(value))}`
}
