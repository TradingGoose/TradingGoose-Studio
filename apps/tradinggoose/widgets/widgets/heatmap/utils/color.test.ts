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

  it('uses solid background utilities for non-neutral buckets', () => {
    for (const changePercent of [0.5, 2, 4, -0.5, -2, -4]) {
      const color = resolveHeatmapTileColor(changePercent)

      expect(color.className).toContain('bg-')
      expect(color.className).not.toContain('/')
      expect(color.className).toContain('text-white')
    }
  })
})
