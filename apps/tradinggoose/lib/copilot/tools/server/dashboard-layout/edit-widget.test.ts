import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from './test-fixtures'

const toolMocks = fx.createDashboardToolMocks()

vi.mock('@/lib/copilot/registry', () => ({ CopilotTool: { edit_widget: 'edit_widget' } }))
vi.mock('@/lib/copilot/tools/server/base-tool', () => fx.mockBaseToolModule(toolMocks))
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

const execute = async (
  args: { params: Record<string, unknown>; panelId?: string },
  context?: Record<string, unknown>
) => {
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

  it('routes effective params through the existing widget mutation path', async () => {
    const listing = { ...fx.AAPL_LISTING, listing_id: 'MSFT' }
    const result = await execute(
      { params: { listing, view: { interval: '1h' } } },
      { workspaceId: undefined }
    )

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
        patch: { params: { view: { interval: '1h' } }, colorPair: { listing } },
        expectedReviewBaseStateHash: 'base-hash',
      })
    )
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      widgets: {
        'chart-widget': {
          params: { listing, data: { provider: 'alpaca' }, view: { interval: '1h' } },
        },
      },
    })
    expect(JSON.parse(result.entityDocument)).not.toHaveProperty('colorPairs')
  })

  it('rejects a layout outside the authenticated owner scope before reading its snapshot', async () => {
    toolMocks.readMetadata.mockRejectedValueOnce(new Error('Dashboard layout not found'))

    await expect(execute({ params: {} })).rejects.toThrow('Dashboard layout not found')
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

    await expect(execute({ params: { view: { interval: '1h' } } })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_widget_target',
      retryable: true,
      issues: [{ path: 'panelId' }],
    })
    expect(toolMocks.applyWidgetEdit).not.toHaveBeenCalled()

    toolMocks.setCurrentContent(fx.createDashboardLayoutTestContent())
    await expect(execute({ panelId: 'missing-panel', params: {} })).rejects.toHaveProperty(
      'code',
      'invalid_widget_target'
    )
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

    expect(toolMocks.applyWidgetEdit).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { params: { view: { interval: '1h' } } } })
    )

    expect(JSON.parse(result.entityDocument).widgets['chart-widget'].params).toMatchObject({
      ...DATA_CHART_PARAMS,
      view: { ...DATA_CHART_PARAMS.view, interval: '1h' },
    })
  })

  it('patches visible data-chart params while preserving and hiding human drawings', async () => {
    const drawTools = [
      {
        id: 'manual-main',
        pane: 'price',
        snapshot: { tools: [{ id: 'line-1', toolType: 'trend_line', points: [] }] },
      },
    ]
    const fields = withWidgetParams('chart-widget', {
      view: { interval: '15m', drawTools },
    })
    toolMocks.setCurrentContent(fields)

    const result = await execute({
      params: {
        view: {
          pineIndicators: [{ id: 'indicator-1' }],
        },
      },
    })

    const visibleParams = JSON.parse(result.entityDocument).widgets['chart-widget'].params
    expect(visibleParams.view).toEqual({
      interval: '15m',
      pineIndicators: [{ id: 'indicator-1' }],
    })
    expect(toolMocks.getCurrentContent().widgets['chart-widget'].params).toEqual({
      view: { interval: '15m', drawTools, pineIndicators: [{ id: 'indicator-1' }] },
    })

    const cleared = await execute({ params: { view: null } })
    expect(JSON.parse(cleared.entityDocument).widgets['chart-widget'].params).toBeNull()
    expect(toolMocks.getCurrentContent().widgets['chart-widget'].params).toEqual({
      view: { drawTools },
    })
  })

  it('rejects data-chart drawing fields from edit_widget', async () => {
    await expect(
      execute({
        params: { view: { drawTools: [{ id: 'manual-main', pane: 'price' }] } },
      })
    ).rejects.toThrow('does not expose this field to Copilot')
    expect(toolMocks.applyWidgetEdit).not.toHaveBeenCalled()
  })

  it('routes a linked-field clear through the selected widget owner', async () => {
    toolMocks.shouldStage.mockReturnValue(true)
    const staged = await execute({ params: { listing: null } }, { accessLevel: 'limited' })
    const after = JSON.parse(staged.preview.documentDiff.after)

    expect(after.widgetDocument.params).not.toHaveProperty('listing')
    expect(JSON.parse(staged.entityDocument)).not.toHaveProperty('colorPairs')

    toolMocks.shouldStage.mockReturnValue(false)
    const applied = await execute({ params: { listing: null } })
    expect(JSON.parse(applied.entityDocument).widgets['chart-widget'].params).not.toHaveProperty(
      'listing'
    )
    expect(toolMocks.applyWidgetEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: 'chart-panel',
        patch: { colorPair: { listing: null } },
      })
    )
  })

  it('stages edit_widget review with selected-widget JSON document diff', async () => {
    const current = fx.createDashboardLayoutTestContent()
    current.widgets['chart-widget'].params = {
      ...DATA_CHART_PARAMS,
      data: { ...DATA_CHART_PARAMS.data, auth: { apiKey: 'stored-secret' } },
    }
    toolMocks.setCurrentContent(current)
    toolMocks.shouldStage.mockReturnValue(true)

    const result = await execute(
      { params: { data: { provider: 'polygon', auth: { apiKey: 'replacement-secret' } } } },
      { accessLevel: 'limited' }
    )

    expect(Object.keys(result.preview)).toEqual(['documentDiff'])
    expect(result.documentFormat).toBe('tg-dashboard-layout-document-v3')
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      layout: { id: 'root', type: 'group' },
      widgets: {
        'chart-widget': {
          params: { data: { provider: 'polygon', auth: { apiKey: '[redacted]' } } },
        },
        'order-widget': { params: null },
      },
    })
    const before = JSON.parse(result.preview.documentDiff.before)
    const after = JSON.parse(result.preview.documentDiff.after)
    expect(before).toMatchObject({
      panelId: 'chart-panel',
      widgetKey: 'data_chart',
      widgetDocument: { params: { listing: { listing_id: 'AAPL' } } },
    })
    expect(after).toMatchObject({
      panelId: 'chart-panel',
      widgetKey: 'data_chart',
      widgetDocument: {
        params: { data: { provider: 'polygon', auth: { apiKey: '[redacted]' } } },
      },
    })
    expect(before.credentialWritePaths).toEqual([])
    expect(after.credentialWritePaths).toEqual(['widgetDocument.params.data.auth.apiKey'])
    expect(before.widgetDocument.params.data.auth.apiKey).toBe('[redacted]')
    expect(after.widgetDocument.params.data.auth.apiKey).toBe('[redacted]')
    expect(JSON.stringify(result)).not.toContain('stored-secret')
    expect(JSON.stringify(result)).not.toContain('replacement-secret')
  })

  it('rejects accepted edit_widget when the reviewed base hash is stale', async () => {
    await expect(
      execute({ params: {} }, { acceptedReviewBaseStateHash: 'different-hash' })
    ).rejects.toThrow('stale_server_tool_review')
  })
})
