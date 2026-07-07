'use client'

import { useCallback, useMemo } from 'react'
import {
  applyResolvedDashboardListings,
  collectDashboardListingIdentities,
} from '@/lib/listing/hydrate-ui'
import { getListingIdentityKey } from '@/lib/listing/identity'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { getFieldsMap } from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  useEntityList,
  useSavedEntityYjsSession,
  useYjsField,
  useYjsStringField,
} from '@/lib/yjs/use-entity-fields'
import { useResolvedListings } from '@/hooks/queries/listing-resolution'
import {
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  type PersistedColorPairsState,
} from '@/widgets/layout'
import { resolveEffectiveDashboardLayout } from '@/widgets/layout-document'

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

export function useDashboardLayoutDocument(input: {
  workspaceId: string | null | undefined
  ownerUserId: string | null | undefined
  layoutId: string | null | undefined
  canWrite: boolean
  initialName: string
  initialLayout: LayoutNode
  initialColorPairs: PersistedColorPairsState | unknown
}) {
  const { doc } = useSavedEntityYjsSession(
    'dashboard_layout',
    input.layoutId,
    input.workspaceId,
    input.ownerUserId,
    input.canWrite ? 'write' : 'read'
  )
  const [name] = useYjsStringField(doc, 'name', input.initialName)
  const [layoutValue] = useYjsField<LayoutNode>(doc, 'layout', input.initialLayout)
  const [colorPairsValue] = useYjsField<PersistedColorPairsState>(
    doc,
    'colorPairs',
    normalizeColorPairsState(input.initialColorPairs)
  )

  const layout = useMemo(() => normalizeDashboardLayout(layoutValue), [layoutValue])
  const colorPairs = useMemo(() => normalizeColorPairsState(colorPairsValue), [colorPairsValue])

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
  const listingIdentities = useMemo(
    () => collectDashboardListingIdentities(layout, colorPairs),
    [colorPairs, layout]
  )
  const currentListingIdentityKey = useMemo(
    () => listingIdentities.map(getListingIdentityKey).join('\u0000'),
    [listingIdentities]
  )
  const initialListingIdentityKey = useMemo(
    () =>
      collectDashboardListingIdentities(input.initialLayout, input.initialColorPairs)
        .map(getListingIdentityKey)
        .join('\u0000'),
    [input.initialColorPairs, input.initialLayout]
  )
  const resolvedListings = useResolvedListings({
    listings: listingIdentities,
    enabled: isProviderReady,
  })
  const hydrated = useMemo(() => {
    if (resolvedListings.data) {
      return applyResolvedDashboardListings(layout, colorPairs, resolvedListings.data)
    }
    if (currentListingIdentityKey === initialListingIdentityKey) {
      return {
        layout: input.initialLayout,
        colorPairs: input.initialColorPairs as PersistedColorPairsState,
      }
    }
    return applyResolvedDashboardListings(layout, colorPairs, {})
  }, [
    colorPairs,
    currentListingIdentityKey,
    initialListingIdentityKey,
    input.initialColorPairs,
    input.initialLayout,
    layout,
    resolvedListings.data,
  ])
  const hydratedLayout = hydrated.layout
  const hydratedColorPairs = hydrated.colorPairs
  const effectiveLayout = useMemo(
    () => resolveEffectiveDashboardLayout(hydratedLayout, hydratedColorPairs),
    [hydratedColorPairs, hydratedLayout]
  )

  return {
    isProviderReady,
    name,
    layout,
    colorPairs,
    mutateLayoutDocument,
    effectiveLayout,
  }
}
