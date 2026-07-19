'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { mutateDashboardLayoutStructureAction } from '@/app/workspace/[workspaceId]/dashboard/actions'
import {
  type DashboardLayoutStructureMutation,
  type DashboardLayoutTopologyNode,
  normalizeDashboardLayoutTopology,
} from '@/widgets/layout-document'

export type DashboardLayoutListEntry = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

function toLayoutListEntry(member: EntityListMember): DashboardLayoutListEntry {
  const name = member.entityName?.trim()
  if (!name) throw new Error(`dashboard_layout ${member.entityId} is missing entityName`)
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
  }
}

export function useDashboardLayoutList(
  workspaceId: string | null | undefined,
  ownerUserId: string | null | undefined
) {
  const { members, ...session } = useEntityList('dashboard_layout', workspaceId, ownerUserId)
  return {
    layouts: useMemo(() => members.map(toLayoutListEntry), [members]),
    ...session,
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
  const { doc, isLoading, error, isTerminalError } = useSavedEntityYjsSession(
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
        await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, mutation)
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
    isProviderReady: Boolean(doc),
    isLoading,
    error,
    isTerminalError,
    resizeReconcileVersion,
    hasResizePersistenceError,
    mutateStructure,
  }
}
