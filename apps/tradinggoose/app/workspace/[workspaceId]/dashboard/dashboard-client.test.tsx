/**
 * @vitest-environment jsdom
 */

import { act, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import type { LayoutTab } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { LayoutNode } from '@/widgets/layout'
import { PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockPathname = '/workspace/ws-a/dashboard'
let mockSelectLayout: ((layoutId: string) => void) | null = null

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

vi.mock('@/lib/branding/branding', () => ({
  useBrandConfig: () => ({
    documentationUrl: 'https://docs.tradinggoose.ai/',
  }),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledgeBasesList: () => ({
    knowledgeBases: [],
  }),
}))

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: ({ center }: { center?: ReactNode }) => <>{center}</>,
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/layout-tabs', () => ({
  LayoutTabs: ({ onSelect }: { onSelect: (layoutId: string) => void }) => {
    mockSelectLayout = onSelect
    return <div data-testid='layout-tabs' />
  },
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
    onPairColorChange,
  }: {
    widget: { pairColor?: string; params?: Record<string, unknown> | null } | null
    context?: { workspaceId?: string }
    panelId?: string
    onPairColorChange?: (color: PairColor) => void
  }) => (
    <div>
      <div
        data-testid={`widget-surface-${panelId ?? 'panel'}`}
        data-pair-color={widget?.pairColor ?? 'gray'}
        data-workflow-id={String(widget?.params?.workflowId ?? '')}
        data-workspace-id={context?.workspaceId ?? ''}
      />
      <button
        type='button'
        data-testid={`pair-color-red-${panelId ?? 'panel'}`}
        onClick={() => onPairColorChange?.('red')}
      />
      <button
        type='button'
        data-testid={`pair-color-blue-${panelId ?? 'panel'}`}
        onClick={() => onPairColorChange?.('blue')}
      />
    </div>
  ),
}))

function RegistryProbe({ channelId }: { channelId: string }) {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowIds[channelId] ?? '')

  return <div data-testid={`registry-${channelId}`} data-active-workflow-id={activeWorkflowId} />
}

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
    mockSelectLayout = null
    resetDashboardStores()
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
      pairColor: 'gray',
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
      pairColor: 'gray',
    })
  })

  it('switches linked pair colors without triggering render-phase registry updates', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root.render(
        <>
          <DashboardClient
            initialState={createPanelLayout('panel-a', 'wf-red', 'red')}
            workspaceId='ws-a'
            layoutId='layout-a'
            initialLayouts={createLayouts('layout-a')}
            initialColorPairs={{
              pairs: [{ color: 'red', workflowId: 'wf-red' }],
            }}
          />
          <RegistryProbe channelId='pair-blue' />
        </>
      )
    })

    expect(usePairColorStore.getState().contexts.red).toMatchObject({
      workflowId: 'wf-red',
    })

    const switchToBlueButton = container.querySelector('[data-testid="pair-color-blue-panel-a"]')
    if (!(switchToBlueButton instanceof HTMLButtonElement)) {
      throw new Error('Expected pair color switch button to be rendered')
    }

    await act(async () => {
      switchToBlueButton.click()
    })

    expect(usePairColorStore.getState().contexts.blue).toMatchObject({
      workflowId: 'wf-red',
    })
    expect(usePairColorStore.getState().contexts.red).toEqual({})

    const registryProbe = container.querySelector('[data-testid="registry-pair-blue"]')
    if (!(registryProbe instanceof HTMLElement)) {
      throw new Error('Expected registry probe to be rendered')
    }

    expect(registryProbe.dataset.activeWorkflowId).toBe('wf-red')
    expect(readWidgetSurface(container)).toEqual({
      workflowId: '',
      workspaceId: 'ws-a',
      pairColor: 'blue',
    })
    expect(hasRenderPhaseUpdateWarning(consoleError.mock.calls)).toBe(false)

    consoleError.mockRestore()
  })

  it('preserves persisted review targets independently from ambient current ids during hydration', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-current', 'red')}
          workspaceId='ws-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{
            pairs: [
              {
                color: 'red',
                workflowId: 'wf-current',
                skillId: 'skill-saved',
                reviewTarget: {
                  reviewSessionId: 'review-draft-skill',
                  reviewEntityKind: 'skill',
                  reviewEntityId: null,
                  reviewDraftSessionId: 'draft-skill',
                },
              },
            ],
          }}
        />
      )
    })

    expect(usePairColorStore.getState().contexts.red).toMatchObject({
      workflowId: 'wf-current',
      skillId: 'skill-saved',
      reviewTarget: {
        reviewSessionId: 'review-draft-skill',
        reviewEntityKind: 'skill',
        reviewEntityId: null,
        reviewDraftSessionId: 'draft-skill',
      },
    })
  })

  it('ignores stale layout switch responses and persists the loaded layout snapshot', async () => {
    const persistedLayoutIds: string[] = []
    const delayedLayoutBResponse = createDeferred<{
      ok: boolean
      status: number
      json: () => Promise<unknown>
    }>()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'

        if (url === '/api/workspaces') {
          return createJsonResponse({ workspaces: [] })
        }

        if (url === '/api/workspaces/ws-a/layout' && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { layoutId?: string }
          persistedLayoutIds.push(body.layoutId ?? '')
          return createJsonResponse({ success: true })
        }

        if (url === '/api/workspaces/ws-a/layout' && method === 'PATCH') {
          return createJsonResponse({ success: true })
        }

        if (url === '/api/workspaces/ws-a/layout?layoutId=layout-b' && method === 'GET') {
          return delayedLayoutBResponse.promise
        }

        if (url === '/api/workspaces/ws-a/layout?layoutId=layout-a' && method === 'GET') {
          return createJsonResponse({
            layoutId: 'layout-a',
            layout: createPanelLayout('panel-a', 'wf-a'),
            colorPairs: { pairs: [] },
            layouts: createLayouts('layout-a'),
          })
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`)
      })
    )

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

    if (!mockSelectLayout) {
      throw new Error('Expected layout select handler to be captured')
    }

    await act(async () => {
      mockSelectLayout?.('layout-b')
      await Promise.resolve()
    })

    await act(async () => {
      mockSelectLayout?.('layout-a')
      await Promise.resolve()
    })

    await act(async () => {
      delayedLayoutBResponse.resolve(
        createJsonResponse({
          layoutId: 'layout-b',
          layout: createPanelLayout('panel-b', 'wf-b'),
          colorPairs: { pairs: [] },
          layouts: createLayouts('layout-b'),
        })
      )
      await Promise.resolve()
    })

    expect(persistedLayoutIds).toEqual(['layout-a', 'layout-a'])
    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-a',
      workspaceId: 'ws-a',
      pairColor: 'gray',
    })
  })
})

function createPanelLayout(
  panelId: string,
  workflowId: string,
  pairColor: PairColor = 'gray'
): LayoutNode {
  return {
    id: panelId,
    type: 'panel',
    widget: {
      key: 'editor_workflow',
      pairColor,
      params: { workflowId },
    },
  }
}

function resetDashboardStores() {
  usePairColorStore.setState({
    contexts: Object.fromEntries(PAIR_COLORS.map((color) => [color, {}])) as Record<
      PairColor,
      PairColorContext
    >,
  })
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowIds: {},
    loadedWorkflowIds: {},
    hydrationByChannel: {},
    deploymentStatuses: {},
    isLoading: false,
    error: null,
  })
}

function createLayouts(layoutId: string): LayoutTab[] {
  return [
    {
      id: 'layout-a',
      name: 'Layout A',
      sortOrder: 0,
      isActive: layoutId === 'layout-a',
    },
    {
      id: 'layout-b',
      name: 'Layout B',
      sortOrder: 1,
      isActive: layoutId === 'layout-b',
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
    pairColor: element.dataset.pairColor ?? 'gray',
  }
}

function hasRenderPhaseUpdateWarning(calls: unknown[][]) {
  return calls.some((call) =>
    call.some(
      (value) =>
        typeof value === 'string' &&
        value.includes('Cannot update a component') &&
        value.includes('while rendering a different component')
    )
  )
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  }
}
