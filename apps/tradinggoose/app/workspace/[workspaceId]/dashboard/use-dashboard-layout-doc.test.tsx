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
const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())
const mockMutateStructure = vi.hoisted(() => vi.fn())

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
    mockMutateStructure.mockReset()
    mockMutateStructure.mockResolvedValue(undefined)
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
    let rejectDepartedResize!: (error: Error) => void
    mockMutateStructure.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectDepartedResize = reject))
    )
    act(() => root?.render(<Capture workspaceId='workspace-1' layoutId='layout-1' />))
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
    act(() => root?.render(<Capture workspaceId='workspace-2' layoutId='layout-2' />))
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
})
