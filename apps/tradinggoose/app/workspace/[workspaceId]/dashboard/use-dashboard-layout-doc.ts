'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingResizeRef = useRef(new Map<string, number[]>())
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeIdentity = JSON.stringify([input.workspaceId ?? null, input.layoutId ?? null])
  const resizeIdentityRef = useRef<string | null>(resizeIdentity)
  resizeIdentityRef.current = resizeIdentity
  const [resizeFailure, setResizeFailure] = useState<{ identity: string; version: number } | null>(
    null
  )
  const resizeReconcileVersion =
    resizeFailure?.identity === resizeIdentity ? resizeFailure.version : 0
  const hasResizePersistenceError = resizeReconcileVersion > 0

  const enqueueStructureMutation = useCallback(
    (mutation: DashboardLayoutStructureMutation) => {
      const commit = async () => {
        if (!input.workspaceId || !input.layoutId) return
        await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, mutation)
      }
      const next = mutationQueueRef.current.then(commit, commit)
      mutationQueueRef.current = next.catch(() => undefined)
      return next
    },
    [input.layoutId, input.workspaceId]
  )

  const flushQueuedResizes = useCallback(async () => {
    if (resizeTimerRef.current) {
      clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = null
    }
    const pendingResizes = Array.from(pendingResizeRef.current, ([groupId, sizes]) => ({
      groupId,
      sizes,
    }))
    pendingResizeRef.current.clear()
    if (pendingResizes.length === 0) return
    try {
      await Promise.all(
        pendingResizes.map(({ groupId, sizes }) =>
          enqueueStructureMutation({ type: 'resize', groupId, sizes })
        )
      )
      if (resizeIdentityRef.current === resizeIdentity) {
        setResizeFailure(null)
      }
    } catch (error) {
      if (resizeIdentityRef.current === resizeIdentity) {
        setResizeFailure((failure) => ({
          identity: resizeIdentity,
          version: failure?.identity === resizeIdentity ? failure.version + 1 : 1,
        }))
      }
      throw error
    }
  }, [enqueueStructureMutation, resizeIdentity])

  const scheduleResizeFlush = useCallback(() => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null
      void flushQueuedResizes().catch(() => undefined)
    }, RESIZE_DEBOUNCE_MS)
  }, [flushQueuedResizes])

  useEffect(() => {
    return () => {
      void flushQueuedResizes().catch(() => undefined)
    }
  }, [flushQueuedResizes])

  const mutateStructure = useCallback(
    async (mutation: Exclude<DashboardLayoutStructureMutation, { type: 'resize' }>) => {
      await flushQueuedResizes()
      await enqueueStructureMutation(mutation)
    },
    [enqueueStructureMutation, flushQueuedResizes]
  )

  const updateGroupSizes = useCallback(
    (groupId: string, sizes: number[]) => {
      pendingResizeRef.current.set(groupId, sizes)
      scheduleResizeFlush()
    },
    [scheduleResizeFlush]
  )

  const splitPanel = useCallback(
    async (panelId: string, direction: 'horizontal' | 'vertical') => {
      await mutateStructure({
        type: 'split',
        panelId,
        direction,
      })
    },
    [mutateStructure]
  )

  const closePanel = useCallback(
    async (panelId: string) => {
      await mutateStructure({
        type: 'close',
        panelId,
      })
    },
    [mutateStructure]
  )

  const replacePanelWidget = useCallback(
    async (panelId: string, widgetKey: string) => {
      await mutateStructure({
        type: 'replace',
        panelId,
        widgetKey,
      })
    },
    [mutateStructure]
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
    splitPanel,
    closePanel,
    replacePanelWidget,
  }
}
