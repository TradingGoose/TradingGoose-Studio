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
const mockMutateStructure = vi.hoisted(() => vi.fn())
const mockMutateList = vi.hoisted(() => vi.fn())

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

vi.mock('@/app/workspace/[workspaceId]/dashboard/actions', () => ({
  mutateDashboardLayoutListAction: mockMutateList,
  mutateDashboardLayoutStructureAction: mockMutateStructure,
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
    latestList = useDashboardLayoutList(workspaceId, ownerUserId, initialLayouts)
    return null
  }
  const renderList = (workspaceId = 'workspace-1', ownerUserId = 'user-1') =>
    act(() => root.render(<CaptureList {...{ workspaceId, ownerUserId }} />))
  const listIds = () => latestList.layouts.map(({ id }: { id: string }) => id)
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
    mockMutateStructure.mockReset()
    mockMutateList.mockReset()
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

  it('keeps list mutations projected until a matching or newer Yjs revision arrives', async () => {
    let resolveMutation!: (result: unknown) => void
    renderList()
    setLiveList()
    const reordered = layoutTabs(['layout-b', 'layout-a'], 1)
    mockMutateList.mockReturnValueOnce(new Promise((resolve) => (resolveMutation = resolve)))

    act(() => {
      void latestList.reorderLayouts(['layout-b', 'layout-a'])
      void latestList.reorderLayouts(['layout-a', 'layout-b'])
    })
    expect(mockMutateList).toHaveBeenCalledOnce()
    expect(listIds()).toEqual(['layout-b', 'layout-a'])
    setLiveList(reordered)
    expect(latestList.isBusy).toBe(true)
    await act(async () => resolveMutation(reordered))
    expect(latestList.isBusy).toBe(false)

    const created = layoutTabs(['layout-b', 'layout-a', 'layout-c'], 2)
    const activated = layoutTabs(['layout-b', 'layout-a', 'layout-c'], 3, 'layout-b')
    const renamed = layoutTabs(['layout-b', 'layout-a', 'layout-c'], 4, 'layout-b', 'Renamed B')
    const deleted = layoutTabs(['layout-b', 'layout-a'], 5, 'layout-b', 'Renamed B')
    const projectedMutations = [
      [() => latestList.createLayout(), created],
      [() => latestList.activateLayout('layout-b'), activated],
      [() => latestList.renameLayout('layout-b', 'Renamed B'), renamed],
      [() => latestList.deleteLayout('layout-c'), deleted],
    ] as const
    for (const [mutate, projected] of projectedMutations) {
      mockMutateList.mockResolvedValueOnce(projected)
      await act(mutate)
      expect(latestList.layouts).toEqual(projected)
      setLiveList(projected)
      expect(latestList.isBusy).toBe(false)
    }

    const activatedLocally = layoutTabs(['layout-b', 'layout-a'], 6, 'layout-a', 'Renamed B')
    mockMutateList.mockResolvedValueOnce(activatedLocally)
    await act(() => latestList.activateLayout('layout-a'))
    expect(latestList.layouts).toEqual(activatedLocally)
    const supersedingActivation = layoutTabs(['layout-b', 'layout-a'], 7, 'layout-b', 'Renamed B')
    setLiveList(supersedingActivation)
    expect(latestList.layouts).toEqual(supersedingActivation)
    expect(latestList.isBusy).toBe(false)

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockMutateList.mockRejectedValueOnce(new Error('reorder failed'))
    await act(() => latestList.reorderLayouts(['layout-a', 'layout-b']))
    expect(latestList.layouts).toEqual(supersedingActivation)
    expect(latestList.isBusy).toBe(false)

    mockMutateList.mockReturnValueOnce(new Promise((resolve) => (resolveMutation = resolve)))
    act(() => void latestList.reorderLayouts(['layout-a', 'layout-b']))
    renderList('workspace-2', 'user-2')
    expect(latestList.isBusy).toBe(false)
    await act(async () => resolveMutation(supersedingActivation))
    consoleError.mockRestore()
  })
})
