import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/copilot/registry', () => ({ CopilotTool: { list_widgets: 'list_widgets' } }))

describe('list_widgets server tool', () => {
  it('lists widgets by category without exposing contract internals', async () => {
    const { listWidgetsServerTool } = await import(
      '@/lib/copilot/tools/server/widgets/list-widgets'
    )

    const listed = await listWidgetsServerTool.execute({ category: 'trading' })
    expect(listed.count).toBeGreaterThan(0)
    expect(listed.widgets.every((widget: any) => widget.category === 'trading')).toBe(true)
    expect(listed.widgets.some((widget: any) => widget.widgetKey === 'data_chart')).toBe(true)
    expect(listed.widgets[0].defaultParams).toBeUndefined()
    expect(listed.widgets[0].paramContract).toBeUndefined()
  })
})
