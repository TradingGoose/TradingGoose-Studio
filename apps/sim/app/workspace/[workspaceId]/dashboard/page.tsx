import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { layoutMap } from '@sim/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import {
  createDefaultColorPairsState,
  createDefaultLayoutState,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  serializeLayout,
} from '@/widgets/layout'

export default async function WorkspaceDashboardPage({
  params,
  searchParams,
}: {
  params: { workspaceId: string }
  searchParams?: { layoutId?: string }
}) {
  const { workspaceId } = params
  const requestedLayoutId = searchParams?.layoutId
  const session = await getSession()

  if (!session?.user?.id) {
    return (
      <div className='p-6 text-muted-foreground text-sm'>
        Please sign in to view this workspace.
      </div>
    )
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

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-background'>
      <div className='flex min-h-0 min-w-0 flex-1 overflow-hidden'>
        <DashboardClient
          initialState={layoutState}
          workspaceId={workspaceId}
          layoutId={activeLayout.id}
          initialLayouts={layoutTabs}
          initialColorPairs={colorPairsState}
        />
      </div>
    </div>
  )
}
