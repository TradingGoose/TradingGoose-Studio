import { describe, expect, it } from 'vitest'
import { getWidgetDefinition, isValidWidgetKey } from '@/widgets/registry'

describe('quick order widget registry', () => {
  it('registers the quick order widget', () => {
    expect(isValidWidgetKey('quick_order')).toBe(true)
    expect(getWidgetDefinition('quick_order')).toMatchObject({
      key: 'quick_order',
      title: 'Quick Order',
      description: 'Manual broker order entry for the selected trading account.',
    })
  })
})
