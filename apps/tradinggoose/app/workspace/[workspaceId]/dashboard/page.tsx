import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMap } from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import {
  areListingIdentitiesEqual,
  toListingValueObject,
  type ListingIdentity,
  type ListingInputValue,
  type ListingResolved,
} from '@/lib/listing/identity'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import {
  createDefaultColorPairsState,
  createDefaultLayoutState,
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  type PersistedColorPairsState,
  serializeLayout,
} from '@/widgets/layout'

type ListingRecord = Record<string, unknown>
type ListingCache = Array<{ listing: ListingIdentity; resolved: ListingResolved | null }>

const readText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

const hasResolvedFields = (
  record: ListingRecord,
  listingType: 'default' | 'crypto' | 'currency'
): boolean => {
  const base = readText(record.base)
  if (!base) return false
  if (listingType !== 'default') {
    const quote = readText(record.quote)
    if (!quote) return false
  }
  return true
}

const mergeResolvedListing = (
  current: ListingRecord,
  resolved: ListingResolved
): ListingRecord => {
  const next: ListingRecord = { ...current }
  let changed = false

  const applyIfMissing = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    const existing = current[key]
    if (existing === undefined || existing === null || existing === '') {
      next[key] = value
      changed = true
    }
  }

  applyIfMissing('listing_id', resolved.listing_id)
  applyIfMissing('base_id', resolved.base_id)
  applyIfMissing('quote_id', resolved.quote_id)
  applyIfMissing('listing_type', resolved.listing_type)
  applyIfMissing('base', resolved.base)
  applyIfMissing('quote', resolved.quote)
  applyIfMissing('name', resolved.name)
  applyIfMissing('iconUrl', resolved.iconUrl)
  applyIfMissing('assetClass', resolved.assetClass)
  applyIfMissing('base_asset_class', resolved.base_asset_class)
  applyIfMissing('quote_asset_class', resolved.quote_asset_class)
  applyIfMissing('primaryMicCode', resolved.primaryMicCode)
  applyIfMissing('marketCode', resolved.marketCode)
  applyIfMissing('countryCode', resolved.countryCode)
  applyIfMissing('cityName', resolved.cityName)
  applyIfMissing('timeZoneName', resolved.timeZoneName)

  return changed ? next : current
}

const resolveListingValue = async (
  value: unknown,
  cache: ListingCache
): Promise<unknown> => {
  if (!value) return value
  if (typeof value === 'string') return null
  if (typeof value !== 'object') return value

  const record = value as ListingRecord
  const listingIdentity = toListingValueObject(record as ListingInputValue)
  if (!listingIdentity) return value
  if (hasResolvedFields(record, listingIdentity.listing_type)) return value

  const cached = cache.find((entry) => areListingIdentitiesEqual(entry.listing, listingIdentity))
  if (cached) {
    return cached.resolved ? mergeResolvedListing(record, cached.resolved) : value
  }

  const resolved = await resolveListingIdentity(listingIdentity).catch(() => null)
  cache.push({ listing: listingIdentity, resolved: resolved ?? null })
  if (!resolved) return value
  return mergeResolvedListing(record, resolved)
}

const hydrateWidgetParams = async (
  params: Record<string, unknown> | null | undefined,
  cache: ListingCache
) => {
  if (!params || typeof params !== 'object') return params
  if (!('listing' in params)) return params

  const listingValue = (params as { listing?: unknown }).listing
  const resolved = await resolveListingValue(listingValue, cache)
  if (resolved === listingValue) return params

  return {
    ...params,
    listing: resolved ?? null,
  }
}

const hydrateLayoutListings = async (
  layout: LayoutNode,
  cache: ListingCache
): Promise<LayoutNode> => {
  if (layout.type === 'panel') {
    const widget = layout.widget
    if (!widget || !widget.params || typeof widget.params !== 'object') {
      return layout
    }

    const hydratedParams = await hydrateWidgetParams(
      widget.params as Record<string, unknown>,
      cache
    )
    if (hydratedParams === widget.params) {
      return layout
    }

    return {
      ...layout,
      widget: {
        ...widget,
        params: hydratedParams ?? null,
      },
    }
  }

  const children = await Promise.all(
    layout.children.map((child) => hydrateLayoutListings(child, cache))
  )
  const changed = children.some((child, index) => child !== layout.children[index])
  if (!changed) return layout
  return {
    ...layout,
    children,
  }
}

const hydrateColorPairsListings = async (
  state: PersistedColorPairsState,
  cache: ListingCache
): Promise<PersistedColorPairsState> => {
  if (!state || !Array.isArray(state.pairs)) return state
  let mutated = false

  const nextPairs = await Promise.all(
    state.pairs.map(async (pair) => {
      const listingValue = pair?.listing
      if (!listingValue) return pair
      const resolved = await resolveListingValue(listingValue, cache)
      if (resolved === listingValue) return pair
      mutated = true
      return {
        ...pair,
        listing: (resolved ?? null) as ListingIdentity | null,
      }
    })
  )

  return mutated ? { pairs: nextPairs } : state
}

export default async function WorkspaceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams?: Promise<{ layoutId?: string }>
}) {
  const { workspaceId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const requestedLayoutId = resolvedSearchParams?.layoutId
  const session = await getSession()

  if (!session?.user?.id) {
    return <div></div>
  }

  const userId = session.user.id

  const layouts = await db
    .select()
    .from(layoutMap)
    .where(and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, userId)))
    .orderBy(asc(layoutMap.sort_order), asc(layoutMap.createdAt))

  let allLayouts = layouts

  if (!allLayouts.length) {
    const defaultLayout = createDefaultLayoutState()
    const defaultColorPairs = createDefaultColorPairsState()
    const [inserted] = await db
      .insert(layoutMap)
      .values({
        id: randomUUID(),
        workspaceId,
        userId,
        name: 'Default Layout',
        sort_order: 0,
        layout: serializeLayout(defaultLayout),
        color_pair: defaultColorPairs,
        isActive: true,
      })
      .returning()

    allLayouts = [inserted]
  }

  const activeLayout =
    (requestedLayoutId ? allLayouts.find((layout) => layout.id === requestedLayoutId) : null) ??
    allLayouts.find((layout) => layout.isActive) ??
    allLayouts[0]

  if (requestedLayoutId && activeLayout && !activeLayout.isActive) {
    await db.transaction(async (tx) => {
      await tx
        .update(layoutMap)
        .set({ isActive: false })
        .where(and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, userId)))

      await tx
        .update(layoutMap)
        .set({ isActive: true })
        .where(
          and(
            eq(layoutMap.id, activeLayout.id),
            eq(layoutMap.workspaceId, workspaceId),
            eq(layoutMap.userId, userId)
          )
        )
    })

    allLayouts = allLayouts.map((layout) => ({
      ...layout,
      isActive: layout.id === activeLayout?.id,
    }))
  }

  const layoutTabs = allLayouts.map((layout) => ({
    id: layout.id,
    name: layout.name,
    sortOrder: layout.sort_order ?? 0,
    isActive: !!layout.isActive,
  }))

  const layoutState = normalizeDashboardLayout(activeLayout?.layout)
  const colorPairsState = normalizeColorPairsState(activeLayout?.color_pair)
  const listingCache: ListingCache = []
  const hydratedLayout = await hydrateLayoutListings(layoutState, listingCache)
  const hydratedColorPairs = await hydrateColorPairsListings(colorPairsState, listingCache)

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-background'>
      <div className='flex min-h-0 min-w-0 flex-1 overflow-hidden'>
        <DashboardClient
          initialState={hydratedLayout}
          workspaceId={workspaceId}
          layoutId={activeLayout.id}
          initialLayouts={layoutTabs}
          initialColorPairs={hydratedColorPairs}
        />
      </div>
    </div>
  )
}
