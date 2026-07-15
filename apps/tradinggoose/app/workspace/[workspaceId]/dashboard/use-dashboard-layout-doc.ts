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

const RESIZE_DEBOUNCE_MS = 100

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
  // Every mutation queue plus pending resize/timer state is owned by one
  // workspace/layout identity, so unresolved work for a departed layout keeps
  // chaining onto its own queue and never blocks the active layout.
  const mutationState = useMemo(
    () => ({
      queue: Promise.resolve() as Promise<void>,
      pendingResizes: new Map<string, number[]>(),
      resizeTimer: null as ReturnType<typeof setTimeout> | null,
      reportResizeOutcome: null as ((failed: boolean) => void) | null,
    }),
    [input.workspaceId, input.layoutId]
  )
  const [resizeReconcileVersion, setResizeReconcileVersion] = useState(0)
  const hasResizePersistenceError = resizeReconcileVersion > 0

  const enqueueStructureMutation = useCallback(
    (mutation: DashboardLayoutStructureMutation) => {
      const commit = async () => {
        if (!input.workspaceId || !input.layoutId) return
        await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, mutation)
      }
      const next = mutationState.queue.then(commit, commit)
      mutationState.queue = next.catch(() => undefined)
      return next
    },
    [input.layoutId, input.workspaceId, mutationState]
  )

  const flushQueuedResizes = useCallback(async () => {
    if (mutationState.resizeTimer) {
      clearTimeout(mutationState.resizeTimer)
      mutationState.resizeTimer = null
    }
    const pendingResizes = Array.from(mutationState.pendingResizes, ([groupId, sizes]) => ({
      groupId,
      sizes,
    }))
    mutationState.pendingResizes.clear()
    if (pendingResizes.length === 0) return
    try {
      await Promise.all(
        pendingResizes.map(({ groupId, sizes }) =>
          enqueueStructureMutation({ type: 'resize', groupId, sizes })
        )
      )
      mutationState.reportResizeOutcome?.(false)
    } catch (error) {
      mutationState.reportResizeOutcome?.(true)
      throw error
    }
  }, [enqueueStructureMutation, mutationState])

  const scheduleResizeFlush = useCallback(() => {
    if (mutationState.resizeTimer) clearTimeout(mutationState.resizeTimer)
    mutationState.resizeTimer = setTimeout(() => {
      mutationState.resizeTimer = null
      void flushQueuedResizes().catch(() => undefined)
    }, RESIZE_DEBOUNCE_MS)
  }, [flushQueuedResizes, mutationState])

  useEffect(() => {
    mutationState.reportResizeOutcome = (failed) =>
      setResizeReconcileVersion((version) => (failed ? version + 1 : 0))
    setResizeReconcileVersion(0)
    return () => {
      mutationState.reportResizeOutcome = null
      void flushQueuedResizes().catch(() => undefined)
    }
  }, [flushQueuedResizes, mutationState])

  const mutateStructure = useCallback(
    async (mutation: Exclude<DashboardLayoutStructureMutation, { type: 'resize' }>) => {
      await flushQueuedResizes()
      await enqueueStructureMutation(mutation)
    },
    [enqueueStructureMutation, flushQueuedResizes]
  )

  const updateGroupSizes = useCallback(
    (groupId: string, sizes: number[]) => {
      mutationState.pendingResizes.set(groupId, sizes)
      scheduleResizeFlush()
    },
    [mutationState, scheduleResizeFlush]
  )

  return {
    doc,
    topology,
    isProviderReady: Boolean(doc),
    isLoading,
    error,
    isTerminalError,
    resizeReconcileVersion,
    hasResizePersistenceError,
    updateGroupSizes,
    mutateStructure,
  }
}
