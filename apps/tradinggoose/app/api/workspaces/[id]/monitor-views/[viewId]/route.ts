import { db } from '@tradinggoose/db'
import { monitorView } from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  normalizeMonitorViewConfig,
  type UpdateMonitorViewBody,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

const getUserId = async () => {
  const session = await getSession()
  return session?.user?.id ?? null
}

const listRows = async (workspaceId: string, userId: string) =>
  db
    .select()
    .from(monitorView)
    .where(and(eq(monitorView.workspaceId, workspaceId), eq(monitorView.userId, userId)))
    .orderBy(asc(monitorView.sort_order), asc(monitorView.createdAt))

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; viewId: string }> }
) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as UpdateMonitorViewBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (typeof body.name === 'undefined' && typeof body.config === 'undefined') {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { id: workspaceId, viewId } = await params

  const [existing] = await db
    .select({ id: monitorView.id })
    .from(monitorView)
    .where(
      and(
        eq(monitorView.id, viewId),
        eq(monitorView.workspaceId, workspaceId),
        eq(monitorView.userId, userId)
      )
    )
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'View not found' }, { status: 404 })
  }

  const nextName = typeof body.name === 'string' ? body.name.trim() : undefined
  if (typeof body.name !== 'undefined' && !nextName) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  await db
    .update(monitorView)
    .set({
      ...(nextName ? { name: nextName } : {}),
      ...(typeof body.config !== 'undefined'
        ? { config: normalizeMonitorViewConfig(body.config) }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(monitorView.id, viewId),
        eq(monitorView.workspaceId, workspaceId),
        eq(monitorView.userId, userId)
      )
    )

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; viewId: string }> }
) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId, viewId } = await params
  const rows = await listRows(workspaceId, userId)
  const index = rows.findIndex((row) => row.id === viewId)

  if (index === -1) {
    return NextResponse.json({ error: 'View not found' }, { status: 404 })
  }

  if (rows.length === 1) {
    return NextResponse.json({ error: 'Cannot delete the last remaining view' }, { status: 400 })
  }

  const row = rows[index]!
  const previousRow = index > 0 ? rows[index - 1] : null
  const nextRow = index < rows.length - 1 ? rows[index + 1] : null
  const nextActiveId = row.isActive ? previousRow?.id ?? nextRow?.id ?? null : null

  await db.transaction(async (tx) => {
    await tx
      .delete(monitorView)
      .where(
        and(
          eq(monitorView.id, viewId),
          eq(monitorView.workspaceId, workspaceId),
          eq(monitorView.userId, userId)
        )
      )

    if (nextActiveId) {
      await tx
        .update(monitorView)
        .set({ isActive: false })
        .where(and(eq(monitorView.workspaceId, workspaceId), eq(monitorView.userId, userId)))

      await tx
        .update(monitorView)
        .set({ isActive: true, updatedAt: new Date() })
        .where(
          and(
            eq(monitorView.id, nextActiveId),
            eq(monitorView.workspaceId, workspaceId),
            eq(monitorView.userId, userId)
          )
        )
    }
  })

  return NextResponse.json({ success: true })
}
