import { vi } from 'vitest'
import type { DashboardLayoutDocumentFields } from '@/widgets/layout-document'

export const TEST_SCOPE = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }
export const TEST_EXECUTION_CONTEXT = { userId: 'user-1', workspaceId: 'workspace-1' }

export const AAPL_LISTING = {
  listing_type: 'default' as const,
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
}

/** Canonical two-panel layout fields with a linked red pair carrying an AAPL listing. */
export const createDashboardLayoutTestFields = (): DashboardLayoutDocumentFields => ({
  name: 'Layout 1',
  layout: {
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [50, 50],
    children: [
      {
        id: 'chart-panel',
        type: 'panel',
        widget: { key: 'data_chart', pairColor: 'red', params: { data: { provider: 'alpaca' } } },
      },
      {
        id: 'order-panel',
        type: 'panel',
        widget: { key: 'quick_order', pairColor: 'red', params: null },
      },
    ],
  },
  colorPairs: { pairs: [{ color: 'red', listing: { ...AAPL_LISTING } }] },
  isActive: true,
  sortOrder: 0,
})

/** Test fields with the default layout children rewritten (widget variants). */
export const createFieldsWithChildren = (
  mutate: (children: any[]) => any[]
): DashboardLayoutDocumentFields => {
  const fields = createDashboardLayoutTestFields()
  const layout = fields.layout as any
  return { ...fields, layout: { ...layout, children: mutate(layout.children) } }
}

export type DashboardToolMocks = ReturnType<typeof createDashboardToolMocks>

/** Mutable mock bundle the edit_widget/edit_layout files' vi.mock factories close over. */
export function createDashboardToolMocks() {
  let currentFields: DashboardLayoutDocumentFields
  return {
    scope: TEST_SCOPE,
    getCurrentFields: () => currentFields,
    setCurrentFields: (fields: DashboardLayoutDocumentFields) => {
      currentFields = fields
    },
    shouldStage: vi.fn(),
    applyLive: vi.fn(async (_scope: any, _layoutId: any, fields: any) => fields),
    listDashboardLayouts: vi.fn(),
    assertAcceptedReviewBase: vi.fn((context: any, hash: string) => {
      if (context?.acceptedReviewBaseStateHash && context.acceptedReviewBaseStateHash !== hash) {
        throw new Error('stale_server_tool_review')
      }
    }),
  }
}

/** Shared beforeEach reset for the dashboard-layout tool test files. */
export function resetDashboardToolMocks(mocks: DashboardToolMocks) {
  vi.clearAllMocks()
  mocks.setCurrentFields(createDashboardLayoutTestFields())
  mocks.shouldStage.mockReturnValue(false)
  mocks.listDashboardLayouts.mockResolvedValue([
    { id: 'layout-1', name: 'Layout 1', sortOrder: 0, isActive: true },
  ])
}

/* vi.mock factory bodies shared by the edit_widget/edit_layout test files. */

export const mockBaseToolModule = (mocks: DashboardToolMocks) => ({
  assertAcceptedServerToolReviewBase: mocks.assertAcceptedReviewBase,
  hashServerToolReviewBase: vi.fn(() => 'base-hash'),
  shouldStageServerToolMutationForReview: mocks.shouldStage,
})

export const mockReadProjectionModule = () => ({
  buildDashboardLayoutReadProjection: vi.fn(async (fields: DashboardLayoutDocumentFields) => ({
    documentFormat: 'tg-dashboard-layout-document-v1',
    entityDocument: JSON.stringify(fields),
    effectiveLayout: fields.layout,
  })),
})

export const mockEntitiesSharedModule = () => ({
  requireEntityId: vi.fn((args: any) => args.entityId),
  verifySavedEntityContext: vi.fn(async () => ({ ...TEST_SCOPE, userId: 'user-1' })),
})

export const mockDashboardSharedModule = (mocks: DashboardToolMocks) => ({
  readLiveDashboardLayoutFields: vi.fn(async () => mocks.getCurrentFields()),
  applyLiveDashboardLayoutFields: mocks.applyLive,
})
