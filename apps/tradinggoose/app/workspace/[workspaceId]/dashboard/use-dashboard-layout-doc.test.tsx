/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedDashboardLayoutSession } from '@/lib/yjs/dashboard-layout-session'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'

let mockLayoutDoc: Y.Doc | null = null
const mockMutateStructure = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())

const topology: DashboardLayoutTopologyNode = {
  id: 'panel-chart',
  type: 'panel',
  identityId: 'widget-chart',
  widgetKey: 'data_chart',
}

function installRawBunDom() {
  if (typeof document !== 'undefined') return

  const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  })
  const globals: Record<string, unknown> = { window, IS_REACT_ACT_ENVIRONMENT: true }
  for (const key of ['document', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'navigator']) {
    globals[key] = window[key as keyof typeof window]
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({ members: [], isLoading: true, error: null }),
  useSavedEntityYjsSession: (...args: unknown[]) => mockUseSavedEntityYjsSession(...args),
  useYjsField: (_doc: unknown, _field: string, initial: unknown) => [initial, vi.fn()],
  useYjsStringField: (_doc: unknown, _field: string, initial: string) => [initial, vi.fn()],
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/actions', () => ({
  mutateDashboardLayoutStructureAction: mockMutateStructure,
}))

describe('useDashboardLayoutDocument live fields', () => {
  let container: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    installRawBunDom()
    mockMutateStructure.mockClear()
    mockUseSavedEntityYjsSession.mockClear()
    mockUseSavedEntityYjsSession.mockImplementation(() => ({
      doc: mockLayoutDoc,
      save: vi.fn(),
      isLoading: false,
      error: null,
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockLayoutDoc = null
  })

  afterEach(() => {
    vi.useRealTimers()
    if (root) act(() => root?.unmount())
    mockLayoutDoc?.destroy()
    mockLayoutDoc = null
    container?.remove()
    root = null
    container = null
  })

  it('uses only matching SSR topology while the provider is not ready', async () => {
    const { useDashboardLayoutDocument } = await import('./use-dashboard-layout-doc')
    let latest: any = null

    const Capture = ({
      layoutId,
      initialTopology,
    }: {
      layoutId: string
      initialTopology?: DashboardLayoutTopologyNode
    }) => {
      latest = useDashboardLayoutDocument({
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        layoutId,
        initialTopology,
      })
      return null
    }

    act(() => {
      root?.render(<Capture layoutId='layout-1' initialTopology={topology} />)
    })

    expect(latest.topology).toEqual(topology)
    expect(latest.doc).toBeNull()
    expect(latest.isProviderReady).toBe(false)
    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'layout-1',
      'workspace-1',
      'user-1',
      'read'
    )
    act(() => {
      root?.render(<Capture layoutId='layout-2' />)
    })

    expect(latest.topology).toBeNull()
    expect(latest.isProviderReady).toBe(false)
  })

  it('recovers from a failed resize without poisoning later mutations', async () => {
    mockLayoutDoc = new Y.Doc()
    seedDashboardLayoutSession(mockLayoutDoc, { layout: topology })
    vi.useFakeTimers()
    const { useDashboardLayoutDocument } = await import('./use-dashboard-layout-doc')
    let latest: any = null
    const Capture = ({ workspaceId, layoutId }: { workspaceId: string; layoutId: string }) => {
      latest = useDashboardLayoutDocument({ workspaceId, ownerUserId: 'user-1', layoutId })
      return null
    }

    mockMutateStructure.mockRejectedValueOnce(new Error('resize failed'))
    act(() => root?.render(<Capture workspaceId='workspace-1' layoutId='layout-1' />))
    act(() => {
      latest.updateGroupSizes('group-1', [20, 80])
      latest.updateGroupSizes('group-1', [35, 65])
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(mockMutateStructure).toHaveBeenCalledTimes(1)
    expect(mockMutateStructure).toHaveBeenCalledWith('workspace-1', 'layout-1', {
      type: 'resize',
      groupId: 'group-1',
      sizes: [35, 65],
    })
    await vi.waitFor(() => expect(latest.hasResizePersistenceError).toBe(true))
    expect(latest.resizeReconcileVersion).toBe(1)

    await act(async () => latest.replacePanelWidget('panel-chart', 'watchlist'))

    act(() => latest.updateGroupSizes('group-1', [40, 60]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await vi.waitFor(() => expect(latest.hasResizePersistenceError).toBe(false))
  })
})
