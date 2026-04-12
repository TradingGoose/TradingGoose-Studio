/**
 * @vitest-environment jsdom
 */

import { act, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutTab } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import type { LayoutNode } from '@/widgets/layout'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockPathname = '/workspace/ws-a/dashboard'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

vi.mock('@/lib/branding/branding', () => ({
  useBrandConfig: () => ({
    documentationUrl: null,
  }),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledgeBasesList: () => ({
    knowledgeBases: [],
  }),
}))

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/layout-tabs', () => ({
  LayoutTabs: () => <div data-testid='layout-tabs' />,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}))

vi.mock('@/widgets/widget-surface', () => ({
  WidgetSurface: ({
    widget,
    context,
    panelId,
  }: {
    widget: { params?: Record<string, unknown> | null } | null
    context?: { workspaceId?: string }
    panelId?: string
  }) => (
    <div
      data-testid={`widget-surface-${panelId ?? 'panel'}`}
      data-workflow-id={String(widget?.params?.workflowId ?? '')}
      data-workspace-id={context?.workspaceId ?? ''}
    />
  ),
}))

describe('DashboardClient', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPush.mockReset()
    mockReplace.mockReset()
    mockPathname = '/workspace/ws-a/dashboard'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ workspaces: [] }),
      }))
    )
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn(() => true),
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('replaces stale widget workflow params when the dashboard identity changes', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
        />
      )
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-a',
      workspaceId: 'ws-a',
    })

    mockPathname = '/workspace/ws-b/dashboard'

    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-b', 'wf-b')}
          workspaceId='ws-b'
          layoutId='layout-b'
          initialLayouts={createLayouts('layout-b')}
        />
      )
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-b',
      workspaceId: 'ws-b',
    })
  })
})

function createPanelLayout(panelId: string, workflowId: string): LayoutNode {
  return {
    id: panelId,
    type: 'panel',
    widget: {
      key: 'editor_workflow',
      pairColor: 'gray',
      params: { workflowId },
    },
  }
}

function createLayouts(layoutId: string): LayoutTab[] {
  return [
    {
      id: layoutId,
      name: 'Default Layout',
      sortOrder: 0,
      isActive: true,
    },
  ]
}

function readWidgetSurface(container: HTMLDivElement) {
  const element = container.querySelector('[data-testid^="widget-surface-"]')
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected widget surface to be rendered')
  }

  return {
    workflowId: element.dataset.workflowId ?? '',
    workspaceId: element.dataset.workspaceId ?? '',
  }
}
