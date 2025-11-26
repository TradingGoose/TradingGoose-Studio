import { db } from '@tradinggoose/db'
import { layoutMap } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; layoutId: string }> }
) {
  const { id: workspaceId, layoutId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { name } = body as { name?: string }

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }

  const trimmed = name.trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  const [existing] = await db
    .select({ id: layoutMap.id })
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

  await db
    .update(layoutMap)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(
      and(
        eq(layoutMap.id, layoutId),
        eq(layoutMap.workspaceId, workspaceId),
        eq(layoutMap.userId, userId)
      )
    )

  return NextResponse.json({ success: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; layoutId: string }> }
) {
  const { id: workspaceId, layoutId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const [existing] = await db
    .select({ id: layoutMap.id, isActive: layoutMap.isActive })
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

  if (existing.isActive) {
    return NextResponse.json({ error: 'Cannot delete active layout' }, { status: 400 })
  }

  await db
    .delete(layoutMap)
    .where(
      and(
        eq(layoutMap.id, layoutId),
        eq(layoutMap.workspaceId, workspaceId),
        eq(layoutMap.userId, userId)
      )
    )

  return NextResponse.json({ success: true })
}
