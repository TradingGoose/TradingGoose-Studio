'use client'

import { useCallback, useMemo } from 'react'
import {
  applyDashboardTopologyMutation,
  getDashboardLayoutMap,
  readDashboardLayoutContent,
  readDashboardLayoutTopology,
  setDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import {
  closeDashboardTopologyPanel,
  type DashboardLayoutTopologyNode,
  normalizeDashboardLayoutTopology,
  replaceDashboardPanelWidget,
  splitDashboardTopologyPanel,
  updateDashboardTopologyGroupSizes,
} from '@/widgets/layout-document'

export type DashboardLayoutListEntry = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  hasDraft?: boolean
  createdAt?: string
  updatedAt?: string
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
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  }
}

export function useDashboardLayoutList(
  workspaceId: string | null | undefined,
  ownerUserId: string | null | undefined
) {
  const { members, isLoading, error } = useEntityList('dashboard_layout', workspaceId, ownerUserId)
  return { layouts: useMemo(() => members.map(toLayoutListEntry), [members]), isLoading, error }
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
    'write'
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

  const updateGroupSizes = useCallback(
    (groupId: string, sizes: number[]) => {
      if (!doc) return
      const current = readDashboardLayoutContent(doc)
      const layout = updateDashboardTopologyGroupSizes(current.layout, groupId, sizes)
      if (layout !== current.layout) setDashboardLayoutTopology(doc, layout, YJS_ORIGINS.USER)
    },
    [doc]
  )

  const splitPanel = useCallback(
    (panelId: string, direction: 'horizontal' | 'vertical') => {
      if (!doc) return
      const current = readDashboardLayoutContent(doc)
      const plan = splitDashboardTopologyPanel(current.layout, current.widgets, panelId, direction)
      if (plan.layout !== current.layout) {
        applyDashboardTopologyMutation(doc, plan, YJS_ORIGINS.USER)
      }
    },
    [doc]
  )

  const closePanel = useCallback(
    (panelId: string) => {
      if (!doc) return
      const current = readDashboardLayoutContent(doc)
      const plan = closeDashboardTopologyPanel(current.layout, panelId)
      if (plan.layout !== current.layout) {
        applyDashboardTopologyMutation(doc, plan, YJS_ORIGINS.USER)
      }
    },
    [doc]
  )

  const replacePanelWidget = useCallback(
    (panelId: string, widgetKey: string) => {
      if (!doc) return
      const current = readDashboardLayoutContent(doc)
      const plan = replaceDashboardPanelWidget(current, panelId, widgetKey)
      if (
        plan.layout !== current.layout ||
        plan.removedIdentityIds.length > 0 ||
        Object.keys(plan.createdWidgets).length > 0
      ) {
        applyDashboardTopologyMutation(doc, plan, YJS_ORIGINS.USER)
      }
    },
    [doc]
  )

  return {
    doc,
    topology,
    isProviderReady: Boolean(doc),
    isLoading,
    error,
    updateGroupSizes,
    splitPanel,
    closePanel,
    replacePanelWidget,
  }
}
