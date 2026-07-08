import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/copilot/registry', () => ({
  CopilotTool: { get_widgets_metadata: 'get_widgets_metadata' },
}))

describe('get_widgets_metadata server tool', () => {
  it('reads serialized widget metadata and rejects unknown widget keys', async () => {
    const { getWidgetsMetadataServerTool } = await import('./get-widgets-metadata')

    const metadata = await getWidgetsMetadataServerTool.execute({
      widgetKeys: ['data_chart', 'watchlist'],
    })
    expect(Object.keys(metadata.metadata)).toEqual(['data_chart', 'watchlist'])
    expect(metadata.metadata.data_chart.widgetKey).toBe('data_chart')
    expect(metadata.metadata.data_chart.sanitizeLocalParams).toBeUndefined()
    expect(metadata.metadata.data_chart.paramContract.map((field: any) => field.field)).toEqual([
      'listing',
      'data',
      'view',
      'runtime',
    ])

    await expect(
      getWidgetsMetadataServerTool.execute({ widgetKeys: ['unknown_widget'] })
    ).rejects.toThrow('Unknown widget key "unknown_widget"')
  })
})
