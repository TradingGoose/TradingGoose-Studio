import { describe, expect, it } from 'vitest'
import {
  formatHeatmapChange,
  formatHeatmapPercent,
  formatHeatmapPrice,
} from '@/widgets/widgets/heatmap/utils/format'

describe('heatmap format helpers', () => {
  it('formats price, percent, and signed change values', () => {
    expect(formatHeatmapPrice(123.456)).toBe('123.46')
    expect(formatHeatmapPercent(1.234)).toBe('+1.23%')
    expect(formatHeatmapChange(1.234)).toBe('+1.234')
    expect(formatHeatmapChange(-123.456)).toBe('-123.46')
    expect(formatHeatmapChange(null)).toBe('N/A')
  })
})
