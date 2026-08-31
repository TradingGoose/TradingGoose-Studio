/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorCustomToolWidget } from '@/widgets/widgets/editor_custom_tool'

const entityListState = vi.hoisted(() => ({ ids: ['tool-1'] }))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({
    members: entityListState.ids.map((entityId) => ({ entityId })),
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children?: React.ReactNode
    render?: React.ReactNode
  }) => <>{render ?? children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/custom-tool-dropdown', () => ({
  CustomToolDropdown: () => <div>custom-tool-dropdown</div>,
}))

vi.mock('@/widgets/widget-config-runtime', async () => {
  const actual = await vi.importActual<any>('@/widgets/widget-config-runtime')
  return {
    ...actual,
    useWidgetConfigRuntimeActions: () => ({
      patchWidgetParams: vi.fn(),
      patchWidgetLinkedParams: vi.fn(),
    }),
  }
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('Custom Tool Editor header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    entityListState.ids = ['tool-1']
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders Export custom tool immediately left of Save custom tool', async () => {
    const header = editorCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_custom_tool',
        params: { customToolId: 'tool-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const exportIndex = buttons.findIndex((button) =>
      button.textContent?.includes('Export custom tool')
    )
    const saveIndex = buttons.findIndex((button) =>
      button.textContent?.includes('Save custom tool')
    )

    expect(exportIndex).toBeGreaterThanOrEqual(0)
    expect(saveIndex).toBe(exportIndex + 1)
  })

  it('disables export when no custom tool is selected', async () => {
    const header = editorCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_custom_tool',
        params: {},
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const exportButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Export custom tool')
    )
    expect(exportButton).toBeDisabled()
  })

  it('disables actions when the selected custom tool leaves the shared list', async () => {
    const renderActions = () =>
      editorCustomToolWidget.renderHeader?.({
        context: { workspaceId: 'workspace-1' } as any,
        panelId: 'panel-1',
        widget: {
          key: 'editor_custom_tool',
          params: { customToolId: 'tool-1' },
          pairColor: 'gray',
        } as any,
      } as any)?.right as ReactNode

    await act(async () => root.render(renderActions()))
    let exportButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Export custom tool')
    )
    expect(exportButton).not.toBeDisabled()

    entityListState.ids = []
    await act(async () => root.render(renderActions()))
    exportButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Export custom tool')
    )
    expect(exportButton).toBeDisabled()
  })
})
