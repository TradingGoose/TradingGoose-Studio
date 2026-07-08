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
    removedPanelIds: [],
    entityDocument: JSON.stringify({ layout: fx.createBareTwoPanelLayout(), ...document }),
  }
  return editLayoutServerTool.execute(args, { ...fx.TEST_EXECUTION_CONTEXT, ...context } as any)
}

describe('edit_layout server tool', () => {
  beforeEach(() => {
    fx.resetDashboardToolMocks(toolMocks)
  })

  const colorPairDocument = { colorPair: { red: { workflowId: 'workflow-1' } } }

  it.each([
    ['sortOrder out of range', { sortOrder: 2 }, 'edit_layout sortOrder is out of range'],
    ['colorPair payloads', colorPairDocument, 'edit_layout cannot modify colorPair'],
  ])('rejects edit_layout %s before staging review', async (_case, document, message) => {
    await expect(execute(document)).rejects.toThrow(message)

    expect(toolMocks.shouldStage).not.toHaveBeenCalled()
    expect(toolMocks.applyLive).not.toHaveBeenCalled()
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
