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
  'gain-low': 'border-emerald-500/35 bg-emerald-500/15 text-foreground',
  'gain-medium': 'border-emerald-500/55 bg-emerald-500/28 text-foreground',
  'gain-high': 'border-emerald-500/75 bg-emerald-500/45 text-foreground',
  'loss-low': 'border-red-500/35 bg-red-500/15 text-foreground',
  'loss-medium': 'border-red-500/55 bg-red-500/28 text-foreground',
  'loss-high': 'border-red-500/75 bg-red-500/45 text-foreground',
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
