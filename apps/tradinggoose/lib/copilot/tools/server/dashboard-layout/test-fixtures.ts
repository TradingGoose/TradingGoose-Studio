import { vi } from 'vitest'
import {
  applyLayoutEditDocument,
  type DashboardLayoutDocumentContent,
  findDashboardTopologyPanel,
  normalizeDashboardLayoutDocumentContent,
} from '@/widgets/layout-document'
import { isPairColor } from '@/widgets/pair-colors'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'

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
    readFields: vi.fn(async () => currentContent),
    readMetadata: vi.fn(async () => ({ name: 'Layout 1', isActive: true, sortOrder: 0 })),
    verifySavedEntityContext: vi.fn(async () => ({ ...TEST_SCOPE, userId: 'user-1' })),
    shouldStage: vi.fn(),
    applyLayoutEdit: vi.fn(async (input: any) => {
      if (input.expectedReviewBaseStateHash !== 'base-hash') {
        throw new Error('stale_server_tool_review')
      }
      const current = currentContent
      const plan = applyLayoutEditDocument(current, input.entityDocument, input.removedPanelIds)
      const widgets = { ...current.widgets, ...plan.createdWidgets }
      for (const identityId of plan.removedIdentityIds) delete widgets[identityId]
      currentContent = normalizeDashboardLayoutDocumentContent({
        ...current,
        layout: plan.layout,
        widgets,
      })
      return currentContent
    }),
    applyWidgetEdit: vi.fn(async (input: any) => {
      if (input.expectedReviewBaseStateHash !== 'base-hash') {
        throw new Error('stale_server_tool_review')
      }
      const current = currentContent
      const panel = findDashboardTopologyPanel(current.layout, input.panelId)!
      const widget = current.widgets[panel.identityId]!
      const pairColor = isPairColor(input.patch.pairColor)
        ? input.patch.pairColor
        : isPairColor(widget.pairColor)
          ? widget.pairColor
          : 'gray'
      const mutation = applyWidgetConfigMutation({
        widgetKey: panel.widgetKey!,
        widget,
        colorPairs: current.colorPairs,
        panelId: input.panelId,
        patch: input.patch,
      })
      currentContent = normalizeDashboardLayoutDocumentContent({
        ...current,
        widgets: { ...current.widgets, [panel.identityId]: mutation.widgetDocument },
        colorPairs: mutation.colorPairs,
      })
      return currentContent
    }),
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
  serializeDashboardLayoutForCopilot: vi.fn((content) => JSON.stringify(content, null, 2)),
  projectDashboardLayoutValueForCopilot: vi.fn((value) => value),
  preserveDashboardLayoutCredentialPlaceholders: vi.fn((value) => value),
})

export const mockEntitiesSharedModule = (mocks: DashboardToolMocks) => ({
  requireEntityId: vi.fn((args: any) => args.entityId),
  verifySavedEntityContext: mocks.verifySavedEntityContext,
})

export const mockBootstrapModule = (mocks: DashboardToolMocks) => ({
  readBootstrappedSavedEntityFields: mocks.readFields,
})

export const mockDashboardOperationsModule = (mocks: DashboardToolMocks) => ({
  readDashboardLayoutMetadata: mocks.readMetadata,
})

export const mockSnapshotBridgeModule = (mocks: DashboardToolMocks) => ({
  applyDashboardLayoutEditInSocketServer: mocks.applyLayoutEdit,
  applyDashboardWidgetEditInSocketServer: mocks.applyWidgetEdit,
})
