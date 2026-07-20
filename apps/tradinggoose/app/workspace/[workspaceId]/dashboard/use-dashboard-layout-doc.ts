'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import {
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import {
  activateDashboardLayoutAction,
  createDashboardLayoutAction,
  deleteDashboardLayoutAction,
  mutateDashboardLayoutStructureAction,
  reorderDashboardLayoutsAction,
} from '@/app/workspace/[workspaceId]/dashboard/actions'
import {
  type DashboardLayoutStructureMutation,
  type DashboardLayoutTopologyNode,
  normalizeDashboardLayoutTopology,
} from '@/widgets/layout-document'

function toLayoutListEntry(member: EntityListMember) {
  const name = member.entityName?.trim()
  if (!name) throw new Error(`dashboard_layout ${member.entityId} is missing entityName`)
  if (typeof member.sortOrder !== 'number' || !Number.isFinite(member.sortOrder)) {
    throw new Error(`dashboard_layout ${member.entityId} is missing sortOrder`)
  }
  return {
    id: member.entityId,
    name,
  }
}

type DashboardLayoutListMutation = {
  scopeKey: string
  layoutOrder: string[] | null
  isSubmitting: boolean
}

export function useDashboardLayoutList(
  workspaceId: string,
  ownerUserId: string,
  initialLayouts: readonly { id: string; name: string }[]
) {
  const { members, ...session } = useEntityList('dashboard_layout', workspaceId, ownerUserId)
  const liveLayouts = useMemo(() => members.map(toLayoutListEntry), [members])
  const layouts = session.hasLiveSnapshot ? liveLayouts : initialLayouts
  const scopeKey = `${workspaceId}:${ownerUserId}`
  const [mutation, setMutation] = useState<DashboardLayoutListMutation | null>(null)
  const mutationRef = useRef<DashboardLayoutListMutation | null>(null)
  const currentMutation = mutation?.scopeKey === scopeKey ? mutation : null
  const displayedLayouts = useMemo(() => {
    if (!currentMutation?.layoutOrder) return layouts
    const layoutsById = new Map(layouts.map((layout) => [layout.id, layout]))
    const seen = new Set<string>()
    const order = currentMutation.layoutOrder.filter((id) => {
      if (!layoutsById.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    for (const layout of layouts) if (!seen.has(layout.id)) order.push(layout.id)
    return order.map((id) => layoutsById.get(id)!)
  }, [currentMutation, layouts])

  useEffect(() => {
    if (!currentMutation?.layoutOrder || currentMutation.isSubmitting) return
    if (layouts.every((layout, index) => layout.id === displayedLayouts[index]?.id)) {
      if (mutationRef.current === currentMutation) mutationRef.current = null
      setMutation((current) => (current === currentMutation ? null : current))
    }
  }, [currentMutation, displayedLayouts, layouts])

  const submit = async (
    action: () => Promise<unknown>,
    layoutOrder?: string[]
  ): Promise<boolean> => {
    if (mutationRef.current?.scopeKey === scopeKey && mutationRef.current.isSubmitting) return false
    const previous =
      mutationRef.current?.scopeKey === scopeKey ? mutationRef.current : currentMutation
    const attempt: DashboardLayoutListMutation = {
      scopeKey,
      layoutOrder: layoutOrder ?? previous?.layoutOrder ?? null,
      isSubmitting: true,
    }
    mutationRef.current = attempt
    setMutation(attempt)
    try {
      await action()
      const settled = attempt.layoutOrder ? { ...attempt, isSubmitting: false } : null
      if (mutationRef.current === attempt) mutationRef.current = settled
      setMutation((current) => (current === attempt ? settled : current))
      return true
    } catch (error) {
      const restored = previous ? { ...previous, isSubmitting: false } : null
      if (mutationRef.current === attempt) mutationRef.current = restored
      setMutation((current) => (current === attempt ? restored : current))
      console.error('Failed to update dashboard layouts:', error)
      return false
    }
  }

  return {
    layouts: displayedLayouts,
    canMutate: session.hasLiveSnapshot && !session.isLoading && !session.error,
    isBusy: currentMutation?.isSubmitting === true,
    createLayout: () => submit(() => createDashboardLayoutAction(workspaceId)),
    activateLayout: (layoutId: string) =>
      submit(() => activateDashboardLayoutAction(workspaceId, layoutId)),
    renameLayout: (layoutId: string, name: string) =>
      submit(() =>
        renameSavedEntityAction({
          entityKind: 'dashboard_layout',
          entityId: layoutId,
          workspaceId,
          name,
        })
      ),
    deleteLayout: (layoutId: string) =>
      submit(() => deleteDashboardLayoutAction(workspaceId, layoutId)),
    reorderLayouts: (layoutOrder: string[]) =>
      submit(() => reorderDashboardLayoutsAction(workspaceId, layoutOrder), [...layoutOrder]),
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
    isLoading,
    error,
    resizeReconcileVersion,
    hasResizePersistenceError,
    mutateStructure,
  }
}
