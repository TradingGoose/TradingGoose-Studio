import { describe, expect, it } from 'vitest'
import { getWidgetCategories, getWidgetDefinition } from '@/widgets/registry'

describe('widget registry categories', () => {
  it('orders selector categories with trading first', () => {
    const categories = getWidgetCategories()

    expect(categories.map((category) => category.key)).toEqual([
      'trading',
      'list',
      'editor',
      'utility',
    ])
    expect(categories.map((category) => category.title)).toEqual([
      'Trading',
      'Lists',
      'Editor',
      'Utils',
    ])
  })

  it('groups trading widgets under Trading and leaves Utils for non-trading widgets', () => {
    const categories = getWidgetCategories()
    const tradingCategory = categories.find((category) => category.key === 'trading')
    const utilityCategory = categories.find((category) => category.key === 'utility')

    expect(tradingCategory?.title).toBe('Trading')
    expect(tradingCategory?.widgets.map((widget) => widget.key)).toEqual(
      expect.arrayContaining([
        'data_chart',
        'portfolio_snapshot',
        'quick_order',
        'heatmap',
        'watchlist',
      ])
    )
    expect(utilityCategory?.widgets.map((widget) => widget.key)).not.toEqual(
      expect.arrayContaining([
        'data_chart',
        'portfolio_snapshot',
        'quick_order',
        'heatmap',
        'watchlist',
      ])
    )
    expect(getWidgetDefinition('heatmap')?.category).toBe('trading')
    expect(getWidgetDefinition('watchlist')?.category).toBe('trading')
  })
})
