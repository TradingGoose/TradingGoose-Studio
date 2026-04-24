import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { monitorView } from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  normalizeMonitorViewConfig,
  type CreateMonitorViewBody,
  type MonitorViewRowResponse,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

const getUserId = async () => {
  const session = await getSession()
  return session?.user?.id ?? null
}

const toRowResponse = (row: typeof monitorView.$inferSelect): MonitorViewRowResponse => ({
  id: row.id,
  name: row.name,
  sortOrder: row.sort_order ?? 0,
  isActive: !!row.isActive,
  config: normalizeMonitorViewConfig(row.config),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const listRows = async (workspaceId: string, userId: string) =>
  db
    .select()
    .from(monitorView)
    .where(and(eq(monitorView.workspaceId, workspaceId), eq(monitorView.userId, userId)))
    .orderBy(asc(monitorView.sort_order), asc(monitorView.createdAt))

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId } = await params
  const rows = await listRows(workspaceId, userId)

  return NextResponse.json({
    data: rows.map(toRowResponse),
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as CreateMonitorViewBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const trimmedName = typeof body.name === 'string' ? body.name.trim() : ''
  if (!trimmedName) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  const { id: workspaceId } = await params
  const existingRows = await listRows(workspaceId, userId)
  const highestSortOrder = existingRows.reduce((max, row) => Math.max(max, row.sort_order ?? -1), -1)
  const normalizedConfig = normalizeMonitorViewConfig(body.config)
  const shouldMakeActive = body.makeActive === true || existingRows.length === 0

  const inserted = await db.transaction(async (tx) => {
    if (shouldMakeActive) {
      await tx
        .update(monitorView)
        .set({ isActive: false })
        .where(and(eq(monitorView.workspaceId, workspaceId), eq(monitorView.userId, userId)))
    }

    const [created] = await tx
      .insert(monitorView)
      .values({
        id: randomUUID(),
        workspaceId,
        userId,
        name: trimmedName,
        sort_order: highestSortOrder + 1,
        config: normalizedConfig,
        isActive: shouldMakeActive,
      })
      .returning()

    return created
  })

  return NextResponse.json(toRowResponse(inserted), { status: 201 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const rawViewOrder = Object.prototype.hasOwnProperty.call(body, 'viewOrder')
    ? (body as any).viewOrder
    : undefined
  if (typeof rawViewOrder !== 'undefined' && !Array.isArray(rawViewOrder)) {
    return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
  }

  if (
    Array.isArray(rawViewOrder) &&
    rawViewOrder.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
  }

  const viewOrder = Array.isArray(rawViewOrder)
    ? rawViewOrder.map((entry) => entry.trim())
    : null
  const activeViewId =
    typeof (body as any).activeViewId === 'string' && (body as any).activeViewId.trim()
      ? (body as any).activeViewId.trim()
      : null

  if (!viewOrder && !activeViewId) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { id: workspaceId } = await params
  const rows = await listRows(workspaceId, userId)
  const currentIds = rows.map((row) => row.id)
  const currentIdSet = new Set(currentIds)

  if (viewOrder) {
    if (viewOrder.length !== currentIds.length || new Set(viewOrder).size !== currentIds.length) {
      return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
    }

    if (viewOrder.some((id: string) => !currentIdSet.has(id))) {
      return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
    }
  }

  if (activeViewId && !currentIdSet.has(activeViewId)) {
    return NextResponse.json({ error: 'Invalid activeViewId' }, { status: 400 })
  }

  await db.transaction(async (tx) => {
    if (viewOrder) {
      for (const [index, viewId] of viewOrder.entries()) {
        await tx
          .update(monitorView)
          .set({ sort_order: index, updatedAt: new Date() })
          .where(
            and(
              eq(monitorView.id, viewId),
              eq(monitorView.workspaceId, workspaceId),
              eq(monitorView.userId, userId)
            )
          )
      }
    }

    if (activeViewId) {
      await tx
        .update(monitorView)
        .set({ isActive: false })
        .where(and(eq(monitorView.workspaceId, workspaceId), eq(monitorView.userId, userId)))

      await tx
        .update(monitorView)
        .set({ isActive: true, updatedAt: new Date() })
        .where(
          and(
            eq(monitorView.id, activeViewId),
            eq(monitorView.workspaceId, workspaceId),
            eq(monitorView.userId, userId)
          )
        )
    }
  })

  return NextResponse.json({ success: true })
}
