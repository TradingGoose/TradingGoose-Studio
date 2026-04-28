import { describe, expect, it } from 'vitest'
import { getWidgetCategories, getWidgetDefinition } from '@/widgets/registry'

describe('widget registry trading category', () => {
  it('groups trading widgets under Trading and leaves Utility for non-trading widgets', () => {
    const categories = getWidgetCategories()
    const tradingCategory = categories.find((category) => category.key === 'trading')
    const utilityCategory = categories.find((category) => category.key === 'utility')

    expect(tradingCategory?.title).toBe('Trading')
    expect(tradingCategory?.widgets.map((widget) => widget.key)).toEqual(
      expect.arrayContaining(['data_chart', 'portfolio_snapshot', 'quick_order', 'heatmap'])
    )
    expect(utilityCategory?.widgets.map((widget) => widget.key)).not.toEqual(
      expect.arrayContaining(['data_chart', 'portfolio_snapshot', 'quick_order', 'heatmap'])
    )
    expect(getWidgetDefinition('heatmap')?.category).toBe('trading')
  })
})
