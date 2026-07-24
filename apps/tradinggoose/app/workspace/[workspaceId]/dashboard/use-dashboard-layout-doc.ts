'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardLayoutTab } from '@/lib/dashboard-layouts/operations'
import {
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import {
  type DashboardLayoutListMutation,
  mutateDashboardLayoutListAction,
} from '@/app/workspace/[workspaceId]/dashboard/actions'
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

type DashboardLayoutListAttempt = {
  scopeKey: string
  layouts: DashboardLayoutTab[]
  revision?: number
}

export function useDashboardLayoutList(
  workspaceId: string,
  ownerUserId: string,
  initialLayouts: DashboardLayoutTab[]
) {
  const { members, ...session } = useEntityList('dashboard_layout', workspaceId, ownerUserId)
  const liveLayouts = useMemo(() => members.map(toLayoutListEntry), [members])
  const layouts = session.hasLiveSnapshot ? liveLayouts : initialLayouts
  const scopeKey = `${workspaceId}:${ownerUserId}`
  const [mutation, setMutation] = useState<DashboardLayoutListAttempt | null>(null)
  const mutationRef = useRef<DashboardLayoutListAttempt | null>(null)
  if (mutationRef.current?.scopeKey !== scopeKey) mutationRef.current = null
  const currentMutation =
    mutation?.scopeKey === scopeKey && mutationRef.current?.scopeKey === scopeKey ? mutation : null

  const submit = async (
    listMutation: DashboardLayoutListMutation,
    pendingLayouts: DashboardLayoutTab[] = layouts
  ) => {
    if (mutationRef.current?.scopeKey === scopeKey) return
    const attempt: DashboardLayoutListAttempt = { scopeKey, layouts: pendingLayouts }
    mutationRef.current = attempt
    setMutation(attempt)
    try {
      const committedLayouts = await mutateDashboardLayoutListAction(workspaceId, listMutation)
      if (mutationRef.current !== attempt) return
      attempt.layouts = committedLayouts
      attempt.revision = Math.max(...committedLayouts.map((layout) => Date.parse(layout.updatedAt)))
      setMutation({ ...attempt })
    } catch (error) {
      console.error('Failed to update dashboard layouts:', error)
      if (mutationRef.current !== attempt) return
      mutationRef.current = null
      setMutation(null)
    }
  }

  useEffect(() => {
    const current = mutationRef.current
    const liveRevision = Math.max(0, ...liveLayouts.map((layout) => Date.parse(layout.updatedAt)))
    if (current?.revision && session.hasLiveSnapshot && liveRevision >= current.revision) {
      mutationRef.current = null
      setMutation(null)
    }
  }, [currentMutation, liveLayouts, scopeKey, session.hasLiveSnapshot])

  return {
    layouts: currentMutation?.layouts ?? layouts,
    canMutate: session.hasLiveSnapshot && !session.isLoading && !session.error,
    isBusy: currentMutation !== null,
    createLayout: () => submit({ type: 'create' }),
    activateLayout: (layoutId: string) => submit({ type: 'activate', layoutId }),
    renameLayout: (layoutId: string, name: string) => submit({ type: 'rename', layoutId, name }),
    deleteLayout: (layoutId: string) => submit({ type: 'delete', layoutId }),
    reorderLayouts: (layoutOrder: string[]) => {
      const pending = [...layouts].sort(
        (left, right) => layoutOrder.indexOf(left.id) - layoutOrder.indexOf(right.id)
      )
      return submit({ type: 'reorder', layoutOrder }, pending)
    },
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
  const hasResizePersistenceError = resizeReconcileVersion > 0

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
    hasResizePersistenceError,
    mutateStructure,
  }
}
