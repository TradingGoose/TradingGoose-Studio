/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedDashboardLayoutSession } from '@/lib/yjs/dashboard-layout-session'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'
import { useDashboardLayoutDocument } from './use-dashboard-layout-doc'

let mockLayoutDoc: Y.Doc | null = null
const mockMutateStructure = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())

const topology: DashboardLayoutTopologyNode = {
  id: 'panel-chart',
  type: 'panel',
  identityId: 'widget-chart',
  widgetKey: 'data_chart',
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
  let latest: any = null

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

  beforeEach(() => {
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
    latest = null
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

  it('uses only matching SSR topology while the provider is not ready', () => {
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

  it('isolates departed layout queues and recovers from resize failures', async () => {
    mockLayoutDoc = new Y.Doc()
    seedDashboardLayoutSession(mockLayoutDoc, { layout: topology })
    vi.useFakeTimers()

    let rejectDepartedResize!: (error: Error) => void
    mockMutateStructure.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectDepartedResize = reject))
    )
    act(() => root?.render(<Capture workspaceId='workspace-1' layoutId='layout-1' />))
    act(() => {
      latest.updateGroupSizes('group-1', [20, 80])
      latest.updateGroupSizes('group-1', [35, 65])
    })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(mockMutateStructure).toHaveBeenCalledTimes(1)
    expect(mockMutateStructure).toHaveBeenLastCalledWith('workspace-1', 'layout-1', {
      type: 'resize',
      groupId: 'group-1',
      sizes: [35, 65],
    })

    const departedSplit = latest.mutateStructure({
      type: 'split',
      panelId: 'panel-chart',
      direction: 'horizontal',
    })
    act(() => {
      latest.updateGroupSizes('group-2', [25, 75])
      root?.render(<Capture workspaceId='workspace-2' layoutId='layout-2' />)
    })
    const replacement = latest.mutateStructure({
      type: 'replace',
      panelId: 'panel-chart',
      widgetKey: 'watchlist',
    })
    await act(async () => Promise.resolve())
    expect(mockMutateStructure).toHaveBeenCalledTimes(2)
    expect(mockMutateStructure).toHaveBeenLastCalledWith('workspace-2', 'layout-2', {
      type: 'replace',
      panelId: 'panel-chart',
      widgetKey: 'watchlist',
    })
    await replacement

    rejectDepartedResize(new Error('departed resize failed'))
    await vi.waitFor(() => expect(mockMutateStructure).toHaveBeenCalledTimes(4))
    expect(mockMutateStructure).toHaveBeenNthCalledWith(3, 'workspace-1', 'layout-1', {
      type: 'resize',
      groupId: 'group-2',
      sizes: [25, 75],
    })
    expect(mockMutateStructure).toHaveBeenNthCalledWith(4, 'workspace-1', 'layout-1', {
      type: 'split',
      panelId: 'panel-chart',
      direction: 'horizontal',
    })
    await departedSplit
    expect(latest.hasResizePersistenceError).toBe(false)

    mockMutateStructure.mockRejectedValueOnce(new Error('resize failed'))
    act(() => latest.updateGroupSizes('group-1', [40, 60]))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    await vi.waitFor(() => expect(latest.hasResizePersistenceError).toBe(true))
    expect(latest.resizeReconcileVersion).toBe(1)

    act(() => latest.updateGroupSizes('group-1', [45, 55]))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    await vi.waitFor(() => expect(latest.hasResizePersistenceError).toBe(false))
  })
})
