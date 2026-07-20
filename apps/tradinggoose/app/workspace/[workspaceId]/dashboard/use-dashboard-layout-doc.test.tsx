/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedDashboardLayoutSession } from '@/lib/yjs/dashboard-layout-session'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'
import { useDashboardLayoutDocument, useDashboardLayoutList } from './use-dashboard-layout-doc'

let mockLayoutDoc: Y.Doc | null = null
let mockEntityList = {
  members: [] as Array<{ entityId: string; entityName: string; sortOrder: number }>,
  hasLiveSnapshot: false,
  isLoading: true,
  error: null as string | null,
}
const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())
const mockMutateStructure = vi.hoisted(() => vi.fn())
const mockListActions = vi.hoisted(() => ({
  activate: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  reorder: vi.fn(),
}))

const topology: DashboardLayoutTopologyNode = {
  id: 'panel-chart',
  type: 'panel',
  identityId: 'widget-chart',
  widgetKey: 'data_chart',
}

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => mockEntityList,
  useSavedEntityYjsSession: (...args: unknown[]) => mockUseSavedEntityYjsSession(...args),
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/actions', () => ({
  activateDashboardLayoutAction: mockListActions.activate,
  createDashboardLayoutAction: mockListActions.create,
  deleteDashboardLayoutAction: mockListActions.remove,
  mutateDashboardLayoutStructureAction: mockMutateStructure,
  reorderDashboardLayoutsAction: mockListActions.reorder,
}))

vi.mock('@/lib/saved-entities/actions', () => ({
  renameSavedEntityAction: mockListActions.rename,
}))

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
    latestList = useDashboardLayoutList(workspaceId, ownerUserId, [
      { id: 'layout-a', name: 'Layout A' },
      { id: 'layout-b', name: 'Layout B' },
    ])
    return null
  }
  const renderList = (workspaceId = 'workspace-1', ownerUserId = 'user-1') =>
    act(() => root.render(<CaptureList {...{ workspaceId, ownerUserId }} />))
  const listIds = () => latestList.layouts.map(({ id }: { id: string }) => id)

  beforeEach(() => {
    mockMutateStructure.mockReset()
    for (const action of Object.values(mockListActions)) {
      action.mockClear()
    }
    mockEntityList = { members: [], hasLiveSnapshot: false, isLoading: true, error: null }
    mockUseSavedEntityYjsSession.mockClear()
    mockUseSavedEntityYjsSession.mockImplementation(() => ({
      doc: mockLayoutDoc,
      isLoading: false,
      error: null,
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    mockLayoutDoc?.destroy()
    mockLayoutDoc = null
    container.remove()
  })

  it('uses only matching SSR topology while the provider is not ready', () => {
    act(() => {
      root.render(<Capture layoutId='layout-1' initialTopology={topology} />)
    })

    expect(latest.topology).toEqual(topology)
    expect(latest.doc).toBeNull()
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
    mockLayoutDoc = new Y.Doc()
    seedDashboardLayoutSession(mockLayoutDoc, { layout: topology })
    let rejectDepartedResize!: (error: Error) => void
    mockMutateStructure.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectDepartedResize = reject))
    )
    act(() => root.render(<Capture workspaceId='workspace-1' layoutId='layout-1' />))
    const departedResize = latest.mutateStructure({
      type: 'resize',
      groupId: 'group-1',
      sizes: [35, 65],
    })
    const departedFailure = expect(departedResize).rejects.toThrow('departed resize failed')
    const departedSplit = latest.mutateStructure({
      type: 'split',
      panelId: 'panel-chart',
      direction: 'horizontal',
    })
    act(() => root.render(<Capture workspaceId='workspace-2' layoutId='layout-2' />))
    const replacement = latest.mutateStructure({
      type: 'replace',
      panelId: 'panel-chart',
      widgetKey: 'watchlist',
    })
    await act(async () => Promise.resolve())
    expect(mockMutateStructure).toHaveBeenCalledTimes(2)
    expect(mockMutateStructure).toHaveBeenNthCalledWith(1, 'workspace-1', 'layout-1', {
      type: 'resize',
      groupId: 'group-1',
      sizes: [35, 65],
    })
    expect(mockMutateStructure).toHaveBeenNthCalledWith(2, 'workspace-2', 'layout-2', {
      type: 'replace',
      panelId: 'panel-chart',
      widgetKey: 'watchlist',
    })
    await replacement

    rejectDepartedResize(new Error('departed resize failed'))
    await departedFailure
    await vi.waitFor(() => expect(mockMutateStructure).toHaveBeenCalledTimes(3))
    expect(mockMutateStructure).toHaveBeenLastCalledWith('workspace-1', 'layout-1', {
      type: 'split',
      panelId: 'panel-chart',
      direction: 'horizontal',
    })
    await departedSplit
    expect(latest.hasResizePersistenceError).toBe(false)

    mockMutateStructure.mockRejectedValueOnce(new Error('resize failed'))
    await act(async () => {
      await expect(
        latest.mutateStructure({ type: 'resize', groupId: 'group-1', sizes: [40, 60] })
      ).rejects.toThrow('resize failed')
    })
    expect(latest.resizeReconcileVersion).toBe(1)
    expect(latest.hasResizePersistenceError).toBe(true)

    await act(async () => {
      await latest.mutateStructure({ type: 'resize', groupId: 'group-1', sizes: [45, 55] })
    })
    expect(latest.hasResizePersistenceError).toBe(false)
  })

  it('reconciles optimistic reorders across success, failure, and scope changes', async () => {
    let resolveReorder!: () => void
    renderList()
    expect(listIds()).toEqual(['layout-a', 'layout-b'])
    expect(latestList.canMutate).toBe(false)
    mockEntityList = liveLayoutList(['layout-a', 'layout-b'])
    renderList()
    mockListActions.reorder.mockReturnValueOnce(
      new Promise<void>((resolve) => (resolveReorder = resolve))
    )

    act(() => {
      void latestList.reorderLayouts(['layout-b', 'layout-a'])
      void latestList.reorderLayouts(['layout-a', 'layout-b'])
    })
    expect(mockListActions.reorder).toHaveBeenCalledTimes(1)
    expect(listIds()).toEqual(['layout-b', 'layout-a'])
    expect(latestList.isBusy).toBe(true)

    renderList()
    expect(listIds()).toEqual(['layout-b', 'layout-a'])
    await act(async () => resolveReorder())
    expect(latestList.isBusy).toBe(false)
    expect(listIds()).toEqual(['layout-b', 'layout-a'])

    mockEntityList = liveLayoutList(['layout-b', 'layout-a'])
    renderList()
    await act(async () =>
      expect(latestList.reorderLayouts(['layout-a', 'layout-b'])).resolves.toBe(true)
    )
    mockEntityList = liveLayoutList(['layout-a', 'layout-b'])
    renderList()
    expect(listIds()).toEqual(['layout-a', 'layout-b'])

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockListActions.reorder.mockRejectedValueOnce(new Error('reorder failed'))
    await act(async () =>
      expect(latestList.reorderLayouts(['layout-b', 'layout-a'])).resolves.toBe(false)
    )
    expect(listIds()).toEqual(['layout-a', 'layout-b'])
    expect(latestList.isBusy).toBe(false)
    mockListActions.reorder.mockReturnValueOnce(
      new Promise<void>((resolve) => (resolveReorder = resolve))
    )
    act(() => void latestList.reorderLayouts(['layout-b', 'layout-a']))
    renderList('workspace-2', 'user-2')
    expect(listIds()).toEqual(['layout-a', 'layout-b'])
    expect(latestList.isBusy).toBe(false)
    await act(async () => resolveReorder())
    expect(listIds()).toEqual(['layout-a', 'layout-b'])
    consoleError.mockRestore()
  })
})

function liveLayoutList(order: string[]) {
  return {
    members: order.map((entityId, sortOrder) => ({
      entityId,
      entityName: entityId === 'layout-a' ? 'Layout A' : 'Layout B',
      sortOrder,
    })),
    hasLiveSnapshot: true,
    isLoading: false,
    error: null,
  }
}
