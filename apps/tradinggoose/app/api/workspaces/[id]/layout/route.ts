import { db } from '@tradinggoose/db'
import { layoutMap } from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hydrateDashboardListingData } from '@/lib/listing/hydrate-ui'
import { normalizeColorPairsState } from '@/widgets/layout'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const searchParams = request.nextUrl.searchParams
  const requestedLayoutId = searchParams.get('layoutId')

  const layouts = await db
    .select()
    .from(layoutMap)
    .where(and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, userId)))
    .orderBy(asc(layoutMap.sort_order), asc(layoutMap.createdAt))

  if (!layouts.length) {
    return NextResponse.json({ error: 'No layouts found' }, { status: 404 })
  }

  const requestedLayout = requestedLayoutId
    ? layouts.find((layout) => layout.id === requestedLayoutId)
    : null
  if (requestedLayoutId && !requestedLayout) {
    return NextResponse.json({ error: 'Layout not found' }, { status: 404 })
  }

  const activeLayout = requestedLayout ?? layouts.find((layout) => layout.isActive) ?? layouts[0]

  if (!activeLayout) {
    return NextResponse.json({ error: 'No active layout' }, { status: 404 })
  }

  if (requestedLayout && !requestedLayout.isActive) {
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
            eq(layoutMap.id, requestedLayout.id),
            eq(layoutMap.workspaceId, workspaceId),
            eq(layoutMap.userId, userId)
          )
        )
    })
    activeLayout.isActive = true
    layouts.forEach((layout) => {
      layout.isActive = layout.id === requestedLayout.id
    })
  }

  const layoutMeta = layouts.map((layout) => ({
    id: layout.id,
    name: layout.name,
    sortOrder: layout.sort_order ?? 0,
    isActive: !!layout.isActive,
  }))

  const { layout: hydratedLayout, colorPairs: hydratedColorPairs } =
    await hydrateDashboardListingData(activeLayout.layout, activeLayout.color_pair)

  return NextResponse.json({
    layoutId: activeLayout.id,
    layout: hydratedLayout,
    colorPairs: hydratedColorPairs,
    layouts: layoutMeta,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { layout, layoutId, colorPairs } = body as {
    layout?: unknown
    layoutId?: string
    colorPairs?: unknown
  }

  if (!layoutId || typeof layoutId !== 'string') {
    return NextResponse.json({ error: 'Missing layoutId' }, { status: 400 })
  }

  if (!layout || typeof layout !== 'object') {
    return NextResponse.json({ error: 'Missing layout' }, { status: 400 })
  }

  const [existing] = await db
    .select({ id: layoutMap.id, colorPair: layoutMap.color_pair })
    .from(layoutMap)
    .where(
      and(
        eq(layoutMap.id, layoutId),
        eq(layoutMap.workspaceId, workspaceId),
        eq(layoutMap.userId, userId)
      )
    )
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Layout not found' }, { status: 404 })
  }

  const normalizedColorPairs = normalizeColorPairsState(
    typeof colorPairs === 'undefined' ? existing?.colorPair : colorPairs
  )

  await db
    .update(layoutMap)
    .set({
      layout,
      color_pair: normalizedColorPairs,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(layoutMap.id, layoutId),
        eq(layoutMap.workspaceId, workspaceId),
        eq(layoutMap.userId, userId)
      )
    )

  return NextResponse.json({ success: true })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { layoutOrder, activeLayoutId } = body as {
    layoutOrder?: string[]
    activeLayoutId?: string
  }

  if (!layoutOrder && !activeLayoutId) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const layouts = await db
    .select({ id: layoutMap.id })
    .from(layoutMap)
    .where(and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, userId)))

  const layoutIds = new Set(layouts.map((layout) => layout.id))

  if (layoutOrder) {
    const filteredOrder = layoutOrder.filter((id) => layoutIds.has(id))
    await db.transaction(async (tx) => {
      await Promise.all(
        filteredOrder.map((id, index) =>
          tx
            .update(layoutMap)
            .set({ sort_order: index })
            .where(
              and(
                eq(layoutMap.id, id),
                eq(layoutMap.workspaceId, workspaceId),
                eq(layoutMap.userId, userId)
              )
            )
        )
      )
    })
  }

  if (activeLayoutId) {
    if (!layoutIds.has(activeLayoutId)) {
      return NextResponse.json({ error: 'Invalid layoutId' }, { status: 400 })
    }

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
            eq(layoutMap.id, activeLayoutId),
            eq(layoutMap.workspaceId, workspaceId),
            eq(layoutMap.userId, userId)
          )
        )
    })
  }

  return NextResponse.json({ success: true })
}
