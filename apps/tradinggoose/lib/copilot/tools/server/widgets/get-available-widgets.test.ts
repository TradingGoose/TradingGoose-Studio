import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/copilot/registry', () => ({
  CopilotTool: { get_available_widgets: 'get_available_widgets' },
}))

describe('get_available_widgets server tool', () => {
  it('lists widgets by category without exposing contract internals', async () => {
    const { getAvailableWidgetsServerTool } = await import(
      '@/lib/copilot/tools/server/widgets/get-available-widgets'
    )

    const listed = await getAvailableWidgetsServerTool.execute({ category: 'trading' })
    expect(listed.count).toBeGreaterThan(0)
    expect(listed.widgets.every((widget: any) => widget.category === 'trading')).toBe(true)
    expect(listed.widgets.some((widget: any) => widget.widgetKey === 'data_chart')).toBe(true)
    expect(listed.widgets[0].defaultParams).toBeUndefined()
    expect(listed.widgets[0].paramContract).toBeUndefined()
  })
})
