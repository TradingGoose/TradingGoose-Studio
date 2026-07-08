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

const execute = async (document: Record<string, unknown>, context?: Record<string, unknown>) => {
  const { editLayoutServerTool } = await import('./edit-layout')
  const args = {
    entityId: 'layout-1',
    entityDocument: JSON.stringify({ ...fx.createDashboardLayoutTestFields(), ...document }),
  }
  return editLayoutServerTool.execute(args, { ...fx.TEST_EXECUTION_CONTEXT, ...context } as any)
}

describe('edit_layout server tool', () => {
  beforeEach(() => {
    fx.resetDashboardToolMocks(toolMocks)
  })

  it('rejects edit_layout sortOrder out of range before staging review', async () => {
    await expect(execute({ sortOrder: 2 })).rejects.toThrow('edit_layout sortOrder is out of range')

    expect(toolMocks.shouldStage).not.toHaveBeenCalled()
    expect(toolMocks.applyLive).not.toHaveBeenCalled()
  })

  it('applies full-document widget and color-pair edits', async () => {
    const current = fx.createDashboardLayoutTestFields()
    if (current.layout.type !== 'group') throw new Error('Expected test layout group')
    const layout = {
      ...current.layout,
      children: current.layout.children.map((child) =>
        child.type === 'panel' && child.id === 'chart-panel'
          ? {
              ...child,
              widget: {
                key: 'data_chart',
                pairColor: 'red',
                params: { data: { provider: 'polygon' } },
              },
            }
          : child
      ),
    }

    const result = await execute({
      layout,
      colorPairs: { pairs: [{ color: 'red', workflowId: 'workflow-1' }] },
    })

    expect(toolMocks.applyLive).toHaveBeenCalledWith(
      toolMocks.scope,
      'layout-1',
      expect.objectContaining({
        layout,
        colorPairs: { pairs: [{ color: 'red', workflowId: 'workflow-1' }] },
      })
    )
    expect(result.layout).toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({ widget: expect.objectContaining({ pairColor: 'red' }) }),
      ]),
    })
    expect(result.colorPairs).toEqual({ pairs: [{ color: 'red', workflowId: 'workflow-1' }] })
  })

  it('stages edit_layout review without applying live fields', async () => {
    toolMocks.shouldStage.mockReturnValue(true)

    const result = await execute({ name: 'Reviewed Layout' }, { accessLevel: 'limited' })

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
