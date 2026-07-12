'use client'

import { useCallback, useMemo } from 'react'
import {
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { mutateDashboardLayoutStructureAction } from '@/app/workspace/[workspaceId]/dashboard/actions'
import {
  type DashboardLayoutTopologyNode,
  normalizeDashboardLayoutTopology,
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

  const updateGroupSizes = useCallback(
    async (groupId: string, sizes: number[]) => {
      if (!input.workspaceId || !input.layoutId) return
      await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, {
        type: 'resize',
        groupId,
        sizes,
      })
    },
    [input.layoutId, input.workspaceId]
  )

  const splitPanel = useCallback(
    async (panelId: string, direction: 'horizontal' | 'vertical') => {
      if (!input.workspaceId || !input.layoutId) return
      await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, {
        type: 'split',
        panelId,
        direction,
      })
    },
    [input.layoutId, input.workspaceId]
  )

  const closePanel = useCallback(
    async (panelId: string) => {
      if (!input.workspaceId || !input.layoutId) return
      await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, {
        type: 'close',
        panelId,
      })
    },
    [input.layoutId, input.workspaceId]
  )

  const replacePanelWidget = useCallback(
    async (panelId: string, widgetKey: string) => {
      if (!input.workspaceId || !input.layoutId) return
      await mutateDashboardLayoutStructureAction(input.workspaceId, input.layoutId, {
        type: 'replace',
        panelId,
        widgetKey,
      })
    },
    [input.layoutId, input.workspaceId]
  )

  return {
    doc,
    topology,
    isProviderReady: Boolean(doc),
    isLoading,
    error,
    isTerminalError,
    updateGroupSizes,
    splitPanel,
    closePanel,
    replacePanelWidget,
  }
}
