import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from './test-fixtures'

const toolMocks = fx.createDashboardToolMocks()

vi.mock('@/lib/copilot/registry', () => ({ CopilotTool: { edit_layout: 'edit_layout' } }))
vi.mock('@/lib/copilot/tools/server/base-tool', () => fx.mockBaseToolModule(toolMocks))
vi.mock('@/lib/dashboard-layouts/read-projection', () => fx.mockReadProjectionModule())
vi.mock('@/lib/copilot/tools/server/entities/shared', () => fx.mockEntitiesSharedModule())
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => fx.mockBootstrapModule(toolMocks))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => fx.mockSnapshotBridgeModule(toolMocks))

const execute = async (
  document: Record<string, unknown>,
  options: { removedPanelIds?: string[]; context?: Record<string, unknown> } = {}
) => {
  const { editLayoutServerTool } = await import('./edit-layout')
  const args = {
    entityId: 'layout-1',
    entityDocument: JSON.stringify(document),
    removedPanelIds: options.removedPanelIds,
  }
  return editLayoutServerTool.execute(args, {
    ...fx.TEST_EXECUTION_CONTEXT,
    ...options.context,
  } as any)
}

const currentStructure = (overrides: Record<string, unknown> = {}) => ({
  layout: {
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [50, 50],
    children: [
      { id: 'chart-panel', type: 'panel' },
      { id: 'order-panel', type: 'panel' },
    ],
  },
  ...overrides,
})

describe('edit_layout server tool', () => {
  beforeEach(() => {
    fx.resetDashboardToolMocks(toolMocks)
  })

  it('rejects row metadata in the topology-only edit_layout contract', async () => {
    await expect(execute(currentStructure({ sortOrder: 2 }))).rejects.toThrow(
      "Unrecognized key(s) in object: 'sortOrder'"
    )

    expect(toolMocks.shouldStage).not.toHaveBeenCalled()
    expect(toolMocks.applyTopology).not.toHaveBeenCalled()
  })

  it('applies raw structure edits while preserving retained widgets and initializing new widgets', async () => {
    const result = await execute(
      {
        layout: {
          id: 'root',
          type: 'group',
          direction: 'horizontal',
          sizes: [50, 50],
          children: [
            { id: 'chart-panel', type: 'panel' },
            { type: 'panel', widget: { key: 'watchlist' } },
          ],
        },
      },
      { removedPanelIds: ['order-panel'] }
    )

    expect(toolMocks.applyTopology).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'layout-1',
        plan: expect.objectContaining({ layout: expect.any(Object) }),
      })
    )
    const plan = toolMocks.applyTopology.mock.calls[0]?.[0]?.plan
    const document = JSON.parse(result.entityDocument)
    expect(document.layout).toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({
          id: 'chart-panel',
          identityId: 'chart-widget',
          widgetKey: 'data_chart',
        }),
        expect.objectContaining({ widgetKey: 'watchlist' }),
      ]),
    })
    expect(Object.values(plan.createdWidgets)).toEqual(
      expect.arrayContaining([expect.objectContaining({ pairColor: 'gray' })])
    )
    const addedPanel = document.layout.children.find(
      (panel: { widgetKey?: string }) => panel.widgetKey === 'watchlist'
    )
    expect(document.widgets['chart-widget']).toEqual({
      pairColor: 'red',
      params: { data: { provider: 'alpaca' } },
    })
    expect(document.widgets[addedPanel.identityId]).toEqual({ pairColor: 'gray', params: null })
  })

  it('owns replacement of an existing panel widget binding', async () => {
    const result = await execute({
      layout: {
        id: 'root',
        type: 'group',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { id: 'chart-panel', type: 'panel', widget: { key: 'watchlist' } },
          { id: 'order-panel', type: 'panel' },
        ],
      },
    })

    const plan = toolMocks.applyTopology.mock.calls[0]?.[0]?.plan
    const document = JSON.parse(result.entityDocument)
    const chartPanel = document.layout.children.find(
      (panel: { id?: string }) => panel.id === 'chart-panel'
    )
    expect(chartPanel).toMatchObject({ widgetKey: 'watchlist' })
    expect(chartPanel.identityId).not.toBe('chart-widget')
    expect(plan.removedIdentityIds).toEqual(['chart-widget'])
    expect(Object.values(plan.createdWidgets)).toEqual([{ pairColor: 'gray', params: null }])
    expect(document.widgets[chartPanel.identityId]).toEqual({ pairColor: 'gray', params: null })
  })

  it('requires removedPanelIds for omitted existing panels', async () => {
    await expect(
      execute({
        layout: {
          id: 'root',
          type: 'group',
          direction: 'horizontal',
          sizes: [100],
          children: [{ id: 'chart-panel', type: 'panel' }],
        },
      })
    ).rejects.toThrow('Existing panels omitted without removedPanelIds')
  })

  it('stages edit_layout review without applying live fields', async () => {
    toolMocks.shouldStage.mockReturnValue(true)

    const result = await execute(currentStructure(), {
      context: { accessLevel: 'limited' },
    })

    expect(result).toMatchObject({
      requiresReview: true,
      entityKind: 'dashboard_layout',
      reviewBaseStateHash: 'base-hash',
      documentFormat: 'tg-dashboard-layout-document-v2',
      preview: {
        documentDiff: {
          before: expect.stringContaining('"widgets"'),
          after: expect.stringContaining('"widgets"'),
        },
      },
    })
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      layout: { id: 'root', type: 'group' },
      widgets: {
        'chart-widget': { params: { data: { provider: 'alpaca' } } },
        'order-widget': { params: null },
      },
      colorPairs: { pairs: [expect.objectContaining({ color: 'red' })] },
    })
    expect(result).not.toHaveProperty('layout')
    expect(result).not.toHaveProperty('colorPairs')
    expect(toolMocks.applyTopology).not.toHaveBeenCalled()
  })
})
