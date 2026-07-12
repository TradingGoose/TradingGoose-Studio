import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from './test-fixtures'

const toolMocks = fx.createDashboardToolMocks()

vi.mock('@/lib/copilot/registry', () => ({ CopilotTool: { edit_widget: 'edit_widget' } }))
vi.mock('@/lib/copilot/tools/server/base-tool', () => fx.mockBaseToolModule(toolMocks))
vi.mock('@/lib/dashboard-layouts/read-projection', () => fx.mockReadProjectionModule())
vi.mock('@/lib/dashboard-layouts/operations', () => fx.mockDashboardOperationsModule(toolMocks))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => fx.mockEntitiesSharedModule(toolMocks))
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => fx.mockBootstrapModule(toolMocks))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => fx.mockSnapshotBridgeModule(toolMocks))

const QUICK_ORDER_PARAMS = {
  provider: 'alpaca',
  serviceId: 'alpaca-paper',
  portfolioIdentity: {
    providerId: 'alpaca',
    credentialId: 'oauth-1',
    serviceId: 'alpaca-paper',
    accountId: 'acct-1',
  },
  marketProvider: 'alpaca',
  marketProviderParams: { feed: 'iex' },
  marketAuth: { apiKey: '{{ ALPACA_API_KEY }}' },
  side: 'buy',
}

const DATA_CHART_PARAMS = {
  data: {
    provider: 'alpaca',
    providerParams: { feed: 'iex' },
    auth: { apiKey: '{{ ALPACA_API_KEY }}' },
  },
  view: { interval: '15m', candleType: 'candle_solid', marketSession: 'regular' },
  runtime: { refreshAt: 100 },
}

const withWidgetParams = (
  widgetId: 'chart-widget' | 'order-widget',
  params: Record<string, unknown>
) => {
  const fields = fx.createDashboardLayoutTestContent()
  return {
    ...fields,
    widgets: {
      ...fields.widgets,
      [widgetId]: {
        ...fields.widgets[widgetId],
        pairColor: 'gray' as const,
        params: structuredClone(params),
      },
    },
  }
}

const execute = async (args: Record<string, unknown>, context?: Record<string, unknown>) => {
  const { editWidgetServerTool } = await import('./edit-widget')
  const ctx = { ...fx.TEST_EXECUTION_CONTEXT, ...context } as any
  return editWidgetServerTool.execute(
    { entityId: 'layout-1', panelId: 'chart-panel', ...args },
    ctx
  )
}

describe('edit_widget server tool', () => {
  beforeEach(() => {
    fx.resetDashboardToolMocks(toolMocks)
  })

  it('applies edit_widget without pruning the independent color store', async () => {
    const result = await execute({ pairColor: 'gray' }, { workspaceId: undefined })

    expect(toolMocks.verifySavedEntityContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: undefined }),
      'dashboard_layout',
      'layout-1',
      'write'
    )
    expect(toolMocks.applyWidgetEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'layout-1',
        panelId: 'chart-panel',
        patch: { pairColor: 'gray' },
        expectedReviewBaseStateHash: 'base-hash',
      })
    )
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      widgets: {
        'chart-widget': { pairColor: 'gray', params: { data: { provider: 'alpaca' } } },
        'order-widget': { pairColor: 'red', params: null },
      },
      colorPairs: { pairs: [{ color: 'red', listing: fx.AAPL_LISTING }] },
    })
  })

  it('rejects a layout outside the authenticated owner scope before reading its snapshot', async () => {
    toolMocks.readMetadata.mockRejectedValueOnce(new Error('Dashboard layout not found'))

    await expect(execute({ pairColor: 'gray' })).rejects.toThrow('Dashboard layout not found')
    expect(toolMocks.readFields).not.toHaveBeenCalled()
  })

  it('rejects empty panels instead of creating a layout binding', async () => {
    toolMocks.setCurrentContent({
      layout: {
        id: 'chart-panel',
        type: 'panel',
        identityId: 'empty-widget',
        widgetKey: null,
      },
      widgets: {
        'empty-widget': { pairColor: 'gray', params: null },
      },
      colorPairs: { pairs: [] },
    })

    await expect(execute({ params: { view: { interval: '1h' } } })).rejects.toThrow(
      'has no widget; use edit_layout'
    )
    expect(toolMocks.applyWidgetEdit).not.toHaveBeenCalled()
  })

  it('patches public edit_widget params without replacing unrelated quick-order params', async () => {
    toolMocks.setCurrentContent(withWidgetParams('order-widget', QUICK_ORDER_PARAMS))

    const result = await execute({ panelId: 'order-panel', params: { side: 'sell' } })

    expect(JSON.parse(result.entityDocument).widgets['order-widget'].params).toMatchObject({
      ...QUICK_ORDER_PARAMS,
      side: 'sell',
    })
  })

  it('deep-patches public edit_widget data-chart params without replacing nested siblings', async () => {
    toolMocks.setCurrentContent(withWidgetParams('chart-widget', DATA_CHART_PARAMS))

    const result = await execute({ params: { view: { interval: '1h' } } })

    expect(JSON.parse(result.entityDocument).widgets['chart-widget'].params).toMatchObject({
      ...DATA_CHART_PARAMS,
      view: { ...DATA_CHART_PARAMS.view, interval: '1h' },
    })
  })

  it('patches nested data-chart indicator references from edit_widget params', async () => {
    const result = await execute({
      params: {
        view: {
          pineIndicators: [{ id: 'indicator-1' }],
          drawTools: [{ id: 'manual-macd', pane: 'indicator', indicatorId: 'MACD' }],
        },
      },
    })

    expect(JSON.parse(result.entityDocument).widgets['chart-widget'].params.view).toMatchObject({
      pineIndicators: [{ id: 'indicator-1' }],
      drawTools: [{ id: 'manual-macd', pane: 'indicator', indicatorId: 'MACD' }],
    })
  })

  it('keeps public edit_widget params null as an explicit local params clear', async () => {
    const result = await execute({ params: null })

    expect(JSON.parse(result.entityDocument).widgets['chart-widget'].params).toBeNull()
  })

  it('clears a linked listing through review and socket color-pair mutations', async () => {
    toolMocks.shouldStage.mockReturnValue(true)
    const staged = await execute({ colorPair: { listing: null } }, { accessLevel: 'limited' })
    const after = JSON.parse(staged.preview.documentDiff.after)

    expect(after.colorPair).toEqual({})
    expect(JSON.parse(staged.entityDocument).colorPairs).toEqual({ pairs: [] })

    toolMocks.shouldStage.mockReturnValue(false)
    const applied = await execute({ colorPair: { listing: null } })
    expect(JSON.parse(applied.entityDocument).colorPairs).toEqual({ pairs: [] })
    expect(toolMocks.applyWidgetEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: 'chart-panel',
        patch: { colorPair: { listing: null } },
      })
    )
  })

  it('stages edit_widget review with selected-widget JSON document diff', async () => {
    toolMocks.shouldStage.mockReturnValue(true)

    const result = await execute(
      { params: { data: { provider: 'polygon' } } },
      { accessLevel: 'limited' }
    )

    expect(Object.keys(result.preview)).toEqual(['documentDiff'])
    expect(result.documentFormat).toBe('tg-dashboard-layout-document-v3')
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      layout: { id: 'root', type: 'group' },
      widgets: {
        'chart-widget': { params: { data: { provider: 'polygon' } } },
        'order-widget': { params: null },
      },
      colorPairs: { pairs: [expect.objectContaining({ color: 'red' })] },
    })
    const before = JSON.parse(result.preview.documentDiff.before)
    const after = JSON.parse(result.preview.documentDiff.after)
    expect(before).toMatchObject({
      panelId: 'chart-panel',
      widgetKey: 'data_chart',
      widgetDocument: { pairColor: 'red' },
      colorPair: { listing: { listing_id: 'AAPL' } },
    })
    expect(after).toMatchObject({
      panelId: 'chart-panel',
      widgetKey: 'data_chart',
      widgetDocument: {
        pairColor: 'red',
        params: { data: { provider: 'polygon' } },
      },
    })
  })

  it('rejects accepted edit_widget when the reviewed base hash is stale', async () => {
    await expect(
      execute({ pairColor: 'gray' }, { acceptedReviewBaseStateHash: 'different-hash' })
    ).rejects.toThrow('stale_server_tool_review')
  })
})
