import { describe, expect, it } from 'vitest'
import { resolveHeatmapTileColor } from '@/widgets/widgets/heatmap/utils/color'

describe('resolveHeatmapTileColor', () => {
  it('uses deterministic change-percent buckets', () => {
    expect(resolveHeatmapTileColor(undefined).bucket).toBe('neutral')
    expect(resolveHeatmapTileColor(0).bucket).toBe('neutral')
    expect(resolveHeatmapTileColor(0.5).bucket).toBe('gain-low')
    expect(resolveHeatmapTileColor(2).bucket).toBe('gain-medium')
    expect(resolveHeatmapTileColor(4).bucket).toBe('gain-high')
    expect(resolveHeatmapTileColor(-0.5).bucket).toBe('loss-low')
    expect(resolveHeatmapTileColor(-2).bucket).toBe('loss-medium')
    expect(resolveHeatmapTileColor(-4).bucket).toBe('loss-high')
  })
})
