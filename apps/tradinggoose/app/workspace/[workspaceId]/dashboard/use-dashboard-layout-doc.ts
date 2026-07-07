'use client'

import { useCallback, useMemo } from 'react'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { getFieldsMap } from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  useEntityList,
  useSavedEntityYjsSession,
  useYjsStringField,
} from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import {
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  type PersistedColorPairsState,
} from '@/widgets/layout'

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
  if (!name) {
    throw new Error(`dashboard_layout list member ${member.entityId} is missing entityName`)
  }
  if (typeof member.sortOrder !== 'number' || !Number.isFinite(member.sortOrder)) {
    throw new Error(`dashboard_layout list member ${member.entityId} is missing sortOrder`)
  }
  if (typeof member.isActive !== 'boolean') {
    throw new Error(`dashboard_layout list member ${member.entityId} is missing isActive`)
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
  const layouts = useMemo(() => members.map(toLayoutListEntry), [members])

  return { layouts, isLoading, error }
}

type DashboardLayoutContentSnapshot = {
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
}

type DashboardLayoutContentMutation = {
  layout?: LayoutNode
  colorPairs?: PersistedColorPairsState
}

function areDashboardLayoutContentSnapshotsEqual(
  left: DashboardLayoutContentSnapshot,
  right: DashboardLayoutContentSnapshot
): boolean {
  return (
    JSON.stringify(left.layout) === JSON.stringify(right.layout) &&
    JSON.stringify(left.colorPairs) === JSON.stringify(right.colorPairs)
  )
}

export function useDashboardLayoutDocument(input: {
  workspaceId: string | null | undefined
  ownerUserId: string | null | undefined
  layoutId: string | null | undefined
  initialName: string
  initialLayout: LayoutNode
  initialColorPairs: PersistedColorPairsState | unknown
}) {
  const { doc } = useSavedEntityYjsSession(
    'dashboard_layout',
    input.layoutId,
    input.workspaceId,
    input.ownerUserId,
    'write'
  )
  const [name] = useYjsStringField(doc, 'name', input.initialName)
  const initialLayout = useMemo(
    () => normalizeDashboardLayout(input.initialLayout),
    [input.initialLayout]
  )
  const initialColorPairs = useMemo(
    () => normalizeColorPairsState(input.initialColorPairs),
    [input.initialColorPairs]
  )
  const fallbackContent = useMemo(
    () => ({
      layout: initialLayout,
      colorPairs: initialColorPairs,
    }),
    [initialColorPairs, initialLayout]
  )

  const subscribeContent = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const fields = getFieldsMap(doc)
    return (cb: () => void) => {
      const handler = (event: { keysChanged: Set<string> }) => {
        if (event.keysChanged.has('layout') || event.keysChanged.has('colorPairs')) {
          cb()
        }
      }
      fields.observe(handler)
      return () => fields.unobserve(handler)
    }
  }, [doc])

  const extractContent = useCallback((): DashboardLayoutContentSnapshot => {
    if (!doc) return fallbackContent
    const fields = getFieldsMap(doc)
    return {
      layout: normalizeDashboardLayout(fields.has('layout') ? fields.get('layout') : initialLayout),
      colorPairs: normalizeColorPairsState(
        fields.has('colorPairs') ? fields.get('colorPairs') : initialColorPairs
      ),
    }
  }, [doc, fallbackContent, initialColorPairs, initialLayout])

  const { layout, colorPairs } = useYjsSubscription(
    subscribeContent,
    extractContent,
    fallbackContent,
    areDashboardLayoutContentSnapshotsEqual
  )

  const mutateLayoutDocument = useCallback(
    (
      mutation:
        | DashboardLayoutContentMutation
        | ((current: DashboardLayoutContentSnapshot) => DashboardLayoutContentMutation | null)
    ) => {
      if (!doc) return
      doc.transact(() => {
        const fields = getFieldsMap(doc)
        const next =
          typeof mutation === 'function'
            ? mutation({
                layout: normalizeDashboardLayout(fields.get('layout')),
                colorPairs: normalizeColorPairsState(fields.get('colorPairs')),
              })
            : mutation
        if (!next) return
        if (next.layout !== undefined) {
          fields.set('layout', next.layout)
        }
        if (next.colorPairs !== undefined) {
          fields.set('colorPairs', normalizeColorPairsState(next.colorPairs))
        }
      }, YJS_ORIGINS.USER)
    },
    [doc]
  )

  const isProviderReady = Boolean(doc)

  return {
    isProviderReady,
    name,
    layout,
    colorPairs,
    mutateLayoutDocument,
  }
}
