/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'
import { useDashboardLayoutDocument, useDashboardLayoutList } from './use-dashboard-layout-doc'

let mockEntityList = {
  members: [] as Array<{
    entityId: string
    entityName: string
    sortOrder: number
    isActive: boolean
  }>,
  hasLiveSnapshot: false,
  isLoading: true,
  error: null as string | null,
}
const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

const topology: DashboardLayoutTopologyNode = {
  id: 'panel-chart',
  type: 'panel',
  identityId: 'widget-chart',
  widgetKey: 'data_chart',
}
const timestamp = (value: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, value)).toISOString()
const layoutTabs = (
  order = ['layout-a', 'layout-b'],
  revision = 0,
  activeId = 'layout-a',
  layoutBName = 'Layout B'
) =>
  order.map((id, sortOrder) => ({
    id,
    name: id === 'layout-b' ? layoutBName : `Layout ${id.slice('layout-'.length).toUpperCase()}`,
    sortOrder,
    isActive: id === activeId,
    updatedAt: timestamp(revision),
  }))
const initialLayouts = layoutTabs()

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => mockEntityList,
  useSavedEntityYjsSession: (...args: unknown[]) => mockUseSavedEntityYjsSession(...args),
}))

vi.stubGlobal('fetch', mockFetch)

describe('useDashboardLayoutDocument live fields', () => {
  let container: HTMLDivElement
  let root: Root
  let latest: any = null
  let latestList: any = null

  const Capture = ({
    workspaceId = 'workspace-1',
    layoutId,
    initialTopology,
  }: {
    workspaceId?: string
    layoutId: string
    initialTopology?: DashboardLayoutTopologyNode
  }) => {
    latest = useDashboardLayoutDocument({
      workspaceId,
      ownerUserId: 'user-1',
      layoutId,
      initialTopology,
    })
    return null
  }

  const CaptureList = ({ workspaceId = 'workspace-1', ownerUserId = 'user-1' }) => {
    latestList = useDashboardLayoutList(workspaceId, ownerUserId, initialLayouts)
    return null
  }
  const renderList = (workspaceId = 'workspace-1', ownerUserId = 'user-1') =>
    act(() => root.render(<CaptureList {...{ workspaceId, ownerUserId }} />))
  const setLiveList = (layouts = initialLayouts) => {
    mockEntityList = {
      members: layouts.map(
        ({ id: entityId, name: entityName, isActive, sortOrder, updatedAt }) => ({
          entityId,
          entityName,
          isActive,
          sortOrder,
          updatedAt,
        })
      ),
      hasLiveSnapshot: true,
      isLoading: false,
      error: null,
    }
    renderList()
  }

  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true })
    mockEntityList = { members: [], hasLiveSnapshot: false, isLoading: true, error: null }
    mockUseSavedEntityYjsSession.mockClear()
    mockUseSavedEntityYjsSession.mockImplementation(() => ({
      doc: null,
      isLoading: false,
      error: null,
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('uses only matching SSR topology while the provider is not ready', () => {
    act(() => {
      root.render(<Capture layoutId='layout-1' initialTopology={topology} />)
    })

    expect(latest.topology).toEqual(topology)
    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'layout-1',
      'workspace-1',
      'user-1',
      'read'
    )
    act(() => {
      root.render(<Capture layoutId='layout-2' />)
    })

    expect(latest.topology).toBeNull()
  })

  it('isolates departed layout queues and recovers from resize failures', async () => {
    const resize = { type: 'resize' as const, groupId: 'group-1', sizes: [35, 65] }
    const split = {
      type: 'split' as const,
      panelId: 'panel-chart',
      direction: 'horizontal' as const,
    }
    const replace = {
      type: 'replace' as const,
      panelId: 'panel-chart',
      widgetKey: 'watchlist' as const,
    }
    let rejectDepartedResize!: (error: Error) => void
    mockFetch.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectDepartedResize = reject))
    )
    act(() => root.render(<Capture workspaceId='workspace-1' layoutId='layout-1' />))
    const departedResize = latest.mutateStructure(resize)
    const departedFailure = expect(departedResize).rejects.toThrow('departed resize failed')
    const departedSplit = latest.mutateStructure(split)
    act(() => root.render(<Capture workspaceId='workspace-2' layoutId='layout-2' />))
    await latest.mutateStructure(replace)
    expect(mockFetch.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
      ['/api/workspaces/workspace-1/dashboard-layouts/layout-1/structure', resize],
      ['/api/workspaces/workspace-2/dashboard-layouts/layout-2/structure', replace],
    ])
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })

    rejectDepartedResize(new Error('departed resize failed'))
    await departedFailure
    await departedSplit
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual(split)

    mockFetch.mockResolvedValueOnce({ ok: false, status: 409 })
    await act(async () =>
      expect(
        latest.mutateStructure({ type: 'resize', groupId: 'group-1', sizes: [40, 60] })
      ).rejects.toThrow('Failed to update dashboard layout (409)')
    )
    expect(latest.resizeReconcileVersion).toBe(1)

    await act(() => latest.mutateStructure({ type: 'resize', groupId: 'group-1', sizes: [45, 55] }))
    expect(latest.resizeReconcileVersion).toBe(0)
  })

  it('projects list mutations until Yjs converges', async () => {
    let resolveMutation!: (result: unknown) => void
    setLiveList()
    const committed = layoutTabs(['layout-b', 'layout-a'], 1)
    mockFetch.mockReturnValueOnce(new Promise((resolve) => (resolveMutation = resolve)))

    act(() => {
      void latestList.reorderLayouts(['layout-b', 'layout-a'])
      void latestList.reorderLayouts(['layout-a', 'layout-b'])
    })
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      type: 'reorder',
      layoutOrder: ['layout-b', 'layout-a'],
    })
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(latestList.layouts).toEqual([initialLayouts[1], initialLayouts[0]])
    expect(latestList.isBusy).toBe(true)
    await act(async () => resolveMutation({ ok: true, json: () => Promise.resolve(committed) }))
    expect(latestList.layouts).toEqual(committed)
    expect(latestList.isBusy).toBe(true)
    setLiveList(layoutTabs(['layout-b'], 2, 'layout-b'))
    expect(latestList.layouts).toHaveLength(1)
    expect(latestList.isBusy).toBe(false)
  })
})
