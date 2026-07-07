import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from './test-fixtures'

const toolMocks = fx.createDashboardToolMocks()

vi.mock('@/lib/copilot/registry', () => ({ CopilotTool: { edit_widget: 'edit_widget' } }))
vi.mock('@/lib/copilot/tools/server/base-tool', () => fx.mockBaseToolModule(toolMocks))
vi.mock('@/lib/dashboard-layouts/read-projection', () => fx.mockReadProjectionModule())
vi.mock('@/lib/copilot/tools/server/widgets/widget-reference-validation', () => ({
  validateWidgetReferenceCandidates: toolMocks.validateWidgetReferenceCandidates,
}))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => fx.mockEntitiesSharedModule())
vi.mock('@/lib/copilot/tools/server/dashboard-layout/shared', () =>
  fx.mockDashboardSharedModule(toolMocks)
)

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

const widgetPanel = (id: string, key: string, params: Record<string, unknown>) => ({
  id,
  type: 'panel',
  widget: { key, pairColor: 'gray', params: structuredClone(params) },
})

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
    const result = await execute({ pairColor: 'gray' })

    expect(toolMocks.applyLive).toHaveBeenCalledWith(
      toolMocks.scope,
      'layout-1',
      expect.objectContaining({
        colorPairs: { pairs: [{ color: 'red', listing: fx.AAPL_LISTING }] },
      })
    )
    expect(result.colorPairDiff).toEqual([])
  })

  it('patches public edit_widget params without replacing unrelated quick-order params', async () => {
    toolMocks.setCurrentFields(
      fx.createFieldsWithChildren((children) => [
        children[0],
        widgetPanel('order-panel', 'quick_order', QUICK_ORDER_PARAMS),
      ])
    )

    const result = await execute({ panelId: 'order-panel', params: { side: 'sell' } })

    expect(result.widget.params).toMatchObject({ ...QUICK_ORDER_PARAMS, side: 'sell' })
  })

  it('deep-patches public edit_widget data-chart params without replacing nested siblings', async () => {
    toolMocks.setCurrentFields(
      fx.createFieldsWithChildren((children) => [
        widgetPanel('chart-panel', 'data_chart', DATA_CHART_PARAMS),
        children[1],
      ])
    )

    const result = await execute({ params: { view: { interval: '1h' } } })

    expect(result.widget.params).toMatchObject({
      ...DATA_CHART_PARAMS,
      view: { ...DATA_CHART_PARAMS.view, interval: '1h' },
    })
  })

  it('validates nested data-chart indicator references from edit_widget params', async () => {
    await execute({
      params: {
        view: {
          pineIndicators: [{ id: 'indicator-1' }],
          drawTools: [{ id: 'manual-macd', pane: 'indicator', indicatorId: 'MACD' }],
        },
      },
    })

    expect(toolMocks.validateWidgetReferenceCandidates).toHaveBeenCalledWith(
      toolMocks.scope,
      expect.objectContaining({
        references: [
          {
            panelId: 'chart-panel',
            path: 'chart-panel.view.pineIndicators[0].id',
            field: 'indicatorId',
            value: 'indicator-1',
          },
          {
            panelId: 'chart-panel',
            path: 'chart-panel.view.drawTools[0].indicatorId',
            field: 'indicatorId',
            value: 'MACD',
          },
        ],
      })
    )
  })

  it('keeps public edit_widget params null as an explicit local params clear', async () => {
    const result = await execute({ params: null })

    expect(result.widget.params).toBeNull()
  })

  it('stages edit_widget review with selected-widget JSON document diff', async () => {
    toolMocks.shouldStage.mockReturnValue(true)

    const result = await execute(
      { params: { data: { provider: 'polygon' } } },
      { accessLevel: 'limited' }
    )

    expect(Object.keys(result.preview)).toEqual(['documentDiff'])
    const before = JSON.parse(result.preview.documentDiff.before)
    const after = JSON.parse(result.preview.documentDiff.after)
    expect(before).toMatchObject({
      panelId: 'chart-panel',
      widget: { key: 'data_chart', pairColor: 'red' },
      colorPair: { listing: { listing_id: 'AAPL' } },
    })
    expect(after).toMatchObject({
      panelId: 'chart-panel',
      widget: { key: 'data_chart', pairColor: 'red' },
    })
    expect(after.effectiveParams).toMatchObject({ data: { provider: 'polygon' } })
  })

  it('rejects accepted edit_widget when the reviewed base hash is stale', async () => {
    await expect(
      execute({ pairColor: 'gray' }, { acceptedReviewBaseStateHash: 'different-hash' })
    ).rejects.toThrow('stale_server_tool_review')
  })

  it('rejects edit_widget when reference validation rejects a candidate', async () => {
    toolMocks.validateWidgetReferenceCandidates.mockRejectedValueOnce(
      new Error('Widget workflowId reference "workflow-missing" is not accessible')
    )

    await expect(
      execute({ widgetKey: 'editor_workflow', params: { workflowId: 'workflow-missing' } })
    ).rejects.toThrow('workflow-missing')
  })
})
