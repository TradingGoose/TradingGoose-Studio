type HeatmapColorBucket =
  | 'neutral'
  | 'gain-low'
  | 'gain-medium'
  | 'gain-high'
  | 'loss-low'
  | 'loss-medium'
  | 'loss-high'

const HEATMAP_COLOR_CLASS_BY_BUCKET: Record<HeatmapColorBucket, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  'gain-low': 'border-emerald-600 bg-emerald-600 text-white',
  'gain-medium': 'border-emerald-700 bg-emerald-700 text-white',
  'gain-high': 'border-emerald-800 bg-emerald-800 text-white',
  'loss-low': 'border-red-600 bg-red-600 text-white',
  'loss-medium': 'border-red-700 bg-red-700 text-white',
  'loss-high': 'border-red-800 bg-red-800 text-white',
}

const resolveMagnitudeBucket = (value: number) => {
  const magnitude = Math.abs(value)
  if (magnitude >= 3) return 'high'
  if (magnitude >= 1) return 'medium'
  return 'low'
}

export const resolveHeatmapTileColor = (changePercent: number | null | undefined) => {
  if (typeof changePercent !== 'number' || !Number.isFinite(changePercent)) {
    return {
      bucket: 'neutral' as const,
      className: HEATMAP_COLOR_CLASS_BY_BUCKET.neutral,
    }
  }

  if (changePercent === 0) {
    return {
      bucket: 'neutral' as const,
      className: HEATMAP_COLOR_CLASS_BY_BUCKET.neutral,
    }
  }

  const direction = changePercent > 0 ? 'gain' : 'loss'
  const bucket = `${direction}-${resolveMagnitudeBucket(changePercent)}` as HeatmapColorBucket

  return {
    bucket,
    className: HEATMAP_COLOR_CLASS_BY_BUCKET[bucket],
  }
}
