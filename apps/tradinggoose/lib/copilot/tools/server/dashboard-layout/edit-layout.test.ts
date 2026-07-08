import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from './test-fixtures'

const toolMocks = fx.createDashboardToolMocks()

vi.mock('@/lib/copilot/registry', () => ({ CopilotTool: { edit_layout: 'edit_layout' } }))
vi.mock('@/lib/copilot/tools/server/base-tool', () => fx.mockBaseToolModule(toolMocks))
vi.mock('@/lib/dashboard-layouts/read-projection', () => fx.mockReadProjectionModule())
vi.mock('@/lib/dashboard-layouts/operations', () => ({
  listDashboardLayouts: toolMocks.listDashboardLayouts,
}))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => fx.mockEntitiesSharedModule())
vi.mock('@/lib/copilot/tools/server/dashboard-layout/shared', () =>
  fx.mockDashboardSharedModule(toolMocks)
)

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

  it('rejects edit_layout sortOrder out of range before staging review', async () => {
    await expect(execute(currentStructure({ sortOrder: 2 }))).rejects.toThrow(
      'edit_layout sortOrder is out of range'
    )

    expect(toolMocks.shouldStage).not.toHaveBeenCalled()
    expect(toolMocks.applyLive).not.toHaveBeenCalled()
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
        name: 'Reviewed Layout',
      },
      { removedPanelIds: ['order-panel'] }
    )

    expect(toolMocks.applyLive).toHaveBeenCalledWith(
      toolMocks.scope,
      'layout-1',
      expect.objectContaining({ name: 'Reviewed Layout' })
    )
    expect(result.layout).toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({
          id: 'chart-panel',
          widget: { key: 'data_chart', pairColor: 'red', params: { data: { provider: 'alpaca' } } },
        }),
        expect.objectContaining({ widget: expect.objectContaining({ key: 'watchlist' }) }),
      ]),
    })
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
    ).rejects.toThrow(
      'Existing panel ids omitted from edit_layout entityDocument without removedPanelIds'
    )
  })

  it('stages edit_layout review without applying live fields', async () => {
    toolMocks.shouldStage.mockReturnValue(true)

    const result = await execute(currentStructure({ name: 'Reviewed Layout' }), {
      context: { accessLevel: 'limited' },
    })

    expect(result).toMatchObject({
      requiresReview: true,
      entityKind: 'dashboard_layout',
      reviewBaseStateHash: 'base-hash',
      layout: { id: 'root', type: 'group' },
      colorPairs: { pairs: [expect.objectContaining({ color: 'red' })] },
      preview: {
        documentDiff: {
          before: expect.stringContaining('"name": "Layout 1"'),
          after: expect.stringContaining('"name":"Reviewed Layout"'),
        },
      },
    })
    expect(toolMocks.applyLive).not.toHaveBeenCalled()
  })
})
