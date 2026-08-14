'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DashboardLayoutListMutation,
  DashboardLayoutTab,
} from '@/lib/dashboard-layouts/operations'
import {
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import {
  type DashboardLayoutStructureMutation,
  type DashboardLayoutTopologyNode,
  normalizeDashboardLayoutTopology,
} from '@/widgets/layout-document'

function toLayoutListEntry(member: EntityListMember) {
  const name = member.entityName?.trim()
  const updatedAt = member.updatedAt?.trim()
  if (!name) throw new Error(`dashboard_layout ${member.entityId} is missing entityName`)
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error(`dashboard_layout ${member.entityId} is missing updatedAt`)
  }
  if (typeof member.sortOrder !== 'number' || !Number.isFinite(member.sortOrder)) {
    throw new Error(`dashboard_layout ${member.entityId} is missing sortOrder`)
  }
  if (typeof member.isActive !== 'boolean') {
    throw new Error(`dashboard_layout ${member.entityId} is missing isActive`)
  }
  return {
    id: member.entityId,
    name,
    sortOrder: member.sortOrder,
    isActive: member.isActive,
    updatedAt,
  }
}

export function useDashboardLayoutList(
  workspaceId: string,
  ownerUserId: string,
  initialLayouts: DashboardLayoutTab[]
) {
  const { members, ...session } = useEntityList('dashboard_layout', workspaceId, ownerUserId)
  const liveLayouts = useMemo(() => members.map(toLayoutListEntry), [members])
  const state = useMemo(
    () => ({ projection: null as DashboardLayoutTab[] | null, pending: false }),
    [workspaceId, ownerUserId]
  )
  const [, rerender] = useState(0)
  const hasConverged =
    !state.pending &&
    state.projection &&
    Math.max(...liveLayouts.map(({ updatedAt }) => Date.parse(updatedAt))) >=
      Math.max(...state.projection.map(({ updatedAt }) => Date.parse(updatedAt)))
  if (hasConverged) state.projection = null
  const view = state.projection ?? (session.hasLiveSnapshot ? liveLayouts : initialLayouts)

  const submit = async (listMutation: DashboardLayoutListMutation) => {
    if (state.pending) return
    const rollback = state.projection
    if (listMutation.type === 'reorder')
      state.projection = listMutation.layoutOrder.map((id) => view.find((tab) => tab.id === id)!)
    state.pending = true
    rerender((version) => version + 1)
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/dashboard-layouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(listMutation),
        }
      )
      if (!response.ok) throw new Error(`Failed to update dashboard layouts (${response.status})`)
      state.projection = (await response.json()) as DashboardLayoutTab[]
    } catch (error) {
      console.error('Failed to update dashboard layouts:', error)
      state.projection = rollback
    }
    state.pending = false
    rerender((version) => version + 1)
  }

  return {
    layouts: view,
    canMutate: session.hasLiveSnapshot && !session.isLoading && !session.error,
    isBusy: state.pending,
    createLayout: () => submit({ type: 'create' }),
    activateLayout: (layoutId: string) => submit({ type: 'activate', layoutId }),
    renameLayout: (layoutId: string, name: string) => submit({ type: 'rename', layoutId, name }),
    deleteLayout: (layoutId: string) => submit({ type: 'delete', layoutId }),
    reorderLayouts: (layoutOrder: string[]) => submit({ type: 'reorder', layoutOrder }),
  }
}

const snapshotsEqual = (
  left: DashboardLayoutTopologyNode | null,
  right: DashboardLayoutTopologyNode | null
) =>
  left === right ||
  (left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right))

export function useDashboardLayoutDocument(input: {
  workspaceId: string | null | undefined
  ownerUserId: string | null | undefined
  layoutId: string | null | undefined
  initialTopology?: DashboardLayoutTopologyNode | null
}) {
  const { doc, isLoading, error } = useSavedEntityYjsSession(
    'dashboard_layout',
    input.layoutId,
    input.workspaceId,
    input.ownerUserId,
    'read'
  )
  const fallback = useMemo<DashboardLayoutTopologyNode | null>(
    () => (input.initialTopology ? normalizeDashboardLayoutTopology(input.initialTopology) : null),
    [input.initialTopology]
  )
  const subscribe = useMemo(() => {
    if (!doc) return (callback: () => void) => () => {}
    const layout = getDashboardLayoutMap(doc)
    return (callback: () => void) => {
      layout.observeDeep(callback)
      return () => layout.unobserveDeep(callback)
    }
  }, [doc])
  const read = useCallback(() => {
    if (!doc) return fallback
    return readDashboardLayoutTopology(doc)
  }, [doc, fallback])
  const topology = useYjsSubscription(subscribe, read, fallback, snapshotsEqual)
  const mutationState = useMemo(
    () => ({
      queue: Promise.resolve() as Promise<void>,
      reportResizeOutcome: null as ((failed: boolean) => void) | null,
    }),
    [input.workspaceId, input.layoutId]
  )
  const [resizeReconcileVersion, setResizeReconcileVersion] = useState(0)

  const mutateStructure = useCallback(
    (mutation: DashboardLayoutStructureMutation) => {
      const commit = async () => {
        if (!input.workspaceId || !input.layoutId) return
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(input.workspaceId)}/dashboard-layouts/${encodeURIComponent(input.layoutId)}/structure`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mutation),
          }
        )
        if (!response.ok) {
          throw new Error(`Failed to update dashboard layout (${response.status})`)
        }
      }
      const next = mutationState.queue.then(commit, commit)
      mutationState.queue = next.catch(() => undefined)
      return mutation.type === 'resize'
        ? next.then(
            () => mutationState.reportResizeOutcome?.(false),
            (error) => {
              mutationState.reportResizeOutcome?.(true)
              throw error
            }
          )
        : next
    },
    [input.layoutId, input.workspaceId, mutationState]
  )

  useEffect(() => {
    mutationState.reportResizeOutcome = (failed) =>
      setResizeReconcileVersion((version) => (failed ? version + 1 : 0))
    setResizeReconcileVersion(0)
    return () => {
      mutationState.reportResizeOutcome = null
    }
  }, [mutationState])

  return {
    doc,
    topology,
    isLoading,
    error,
    resizeReconcileVersion,
    mutateStructure,
  }
}
