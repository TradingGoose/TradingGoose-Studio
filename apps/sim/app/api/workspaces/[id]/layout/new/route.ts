import { randomUUID } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { asc, and, eq } from 'drizzle-orm'
import { createDefaultColorPairsState, createDefaultLayoutState, serializeLayout } from '@/widgets/layout'
import { db } from '@sim/db'
import { layoutMap } from '@sim/db/schema'
import { getSession } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const layouts = await db
    .select()
    .from(layoutMap)
    .where(and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, userId)))
    .orderBy(asc(layoutMap.sort_order), asc(layoutMap.createdAt))

  const highestSortOrder = layouts.reduce((max, layout) => {
    return Math.max(max, layout.sort_order ?? -1)
  }, -1)

  const defaultLayout = createDefaultLayoutState()
  const defaultColorPairs = createDefaultColorPairsState()

  const [inserted] = await db
    .insert(layoutMap)
    .values({
      id: randomUUID(),
      workspaceId,
      userId,
      name: `Layout ${layouts.length + 1}`,
      sort_order: highestSortOrder + 1,
      layout: serializeLayout(defaultLayout),
      color_pair: defaultColorPairs,
      isActive: false,
    })
    .returning()

  return NextResponse.json({
    layout: {
      id: inserted.id,
      name: inserted.name,
      sortOrder: inserted.sort_order,
      isActive: false,
    },
  })
}
