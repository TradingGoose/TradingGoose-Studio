import { vi } from 'vitest'
import type { DashboardLayoutDocumentContent } from '@/widgets/layout-document'

export const TEST_SCOPE = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }
export const TEST_EXECUTION_CONTEXT = { userId: 'user-1', workspaceId: 'workspace-1' }

export const AAPL_LISTING = {
  listing_type: 'default' as const,
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
}

export const createDashboardLayoutTestContent = (): DashboardLayoutDocumentContent => ({
  layout: {
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [50, 50],
    children: [
      {
        id: 'chart-panel',
        type: 'panel',
        identityId: 'chart-widget',
        widgetKey: 'data_chart',
      },
      {
        id: 'order-panel',
        type: 'panel',
        identityId: 'order-widget',
        widgetKey: 'quick_order',
      },
    ],
  },
  widgets: {
    'chart-widget': {
      pairColor: 'red',
      params: { data: { provider: 'alpaca' } },
    },
    'order-widget': {
      pairColor: 'red',
      params: null,
    },
  },
  colorPairs: { pairs: [{ color: 'red', listing: { ...AAPL_LISTING } }] },
})

export type DashboardToolMocks = ReturnType<typeof createDashboardToolMocks>

export function createDashboardToolMocks() {
  let currentContent: DashboardLayoutDocumentContent
  return {
    getCurrentContent: () => currentContent,
    setCurrentContent: (content: DashboardLayoutDocumentContent) => {
      currentContent = content
    },
    shouldStage: vi.fn(),
    applyTopology: vi.fn(async (_input: any) => undefined),
    applyWidget: vi.fn(async (_input: any) => undefined),
    assertAcceptedReviewBase: vi.fn((context: any, hash: string) => {
      if (context?.acceptedReviewBaseStateHash && context.acceptedReviewBaseStateHash !== hash) {
        throw new Error('stale_server_tool_review')
      }
    }),
  }
}

export function resetDashboardToolMocks(mocks: DashboardToolMocks) {
  vi.clearAllMocks()
  mocks.setCurrentContent(createDashboardLayoutTestContent())
  mocks.shouldStage.mockReturnValue(false)
}

export const mockBaseToolModule = (mocks: DashboardToolMocks) => ({
  assertAcceptedServerToolReviewBase: mocks.assertAcceptedReviewBase,
  hashServerToolReviewBase: vi.fn(() => 'base-hash'),
  shouldStageServerToolMutationForReview: mocks.shouldStage,
})

export const mockReadProjectionModule = () => ({
  buildDashboardLayoutReadProjection: vi.fn(async (content: DashboardLayoutDocumentContent) => ({
    documentFormat: 'tg-dashboard-layout-document-v2',
    entityDocument: JSON.stringify(content),
    effectiveLayout: content.layout,
  })),
})

export const mockEntitiesSharedModule = () => ({
  buildSavedEntityListInfo: vi.fn(async () => [
    { entityId: 'layout-1', entityName: 'Layout 1', sortOrder: 0, isActive: true },
  ]),
  requireEntityId: vi.fn((args: any) => args.entityId),
  verifySavedEntityContext: vi.fn(async () => ({ ...TEST_SCOPE, userId: 'user-1' })),
})

export const mockBootstrapModule = (mocks: DashboardToolMocks) => ({
  readBootstrappedSavedEntityFields: vi.fn(async () => mocks.getCurrentContent()),
})

export const mockSnapshotBridgeModule = (mocks: DashboardToolMocks) => ({
  applyDashboardTopologyMutationInSocketServer: mocks.applyTopology,
  applyDashboardWidgetMutationInSocketServer: mocks.applyWidget,
})
