import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMap } from '@tradinggoose/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  deleteYjsSessionInSocketServer,
  refreshEntityListSession,
} from '@/lib/yjs/server/snapshot-bridge'
import type { PersistedColorPairsState } from '@/widgets/layout'
import {
  createDefaultDashboardLayoutContent,
  type DashboardLayoutDocumentContent,
  type DashboardLayoutTopologyNode,
  normalizeDashboardLayoutDocumentContent,
  type PersistedDashboardLayoutContent,
} from '@/widgets/layout-document'

export type DashboardLayoutOwnerScope = {
  workspaceId: string
  ownerUserId: string
}

export type DashboardLayoutTab = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  hasDraft?: boolean
  createdAt?: string
  updatedAt?: string
}

export type DashboardLayoutProjection = DashboardLayoutTab & {
  topology: DashboardLayoutTopologyNode
}

type LayoutRow = typeof layoutMap.$inferSelect
type DashboardLayoutReadStore = Pick<typeof db, 'select'>
type DashboardLayoutWriteStore = Pick<
  typeof db,
  'delete' | 'execute' | 'insert' | 'select' | 'update'
>

const DASHBOARD_LAYOUT_OWNER_LOCK_NAMESPACE = 1_904_202_616

export class DashboardLayoutOperationError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'DashboardLayoutOperationError'
  }
}

const ownedWhere = (scope: DashboardLayoutOwnerScope, layoutId?: string) =>
  and(
    ...(layoutId === undefined ? [] : [eq(layoutMap.id, layoutId)]),
    eq(layoutMap.workspaceId, scope.workspaceId),
    eq(layoutMap.userId, scope.ownerUserId)
  )

function readLayoutSortOrder(row: LayoutRow): number {
  if (typeof row.sort_order !== 'number' || !Number.isFinite(row.sort_order)) {
    throw new DashboardLayoutOperationError(500, `Layout ${row.id} is missing sort_order`)
  }
  return row.sort_order
}

function toLayoutTab(row: LayoutRow): DashboardLayoutTab {
  return {
    id: row.id,
    name: row.name,
    sortOrder: readLayoutSortOrder(row),
    isActive: row.isActive,
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  }
}

function rowToContent(row: LayoutRow): DashboardLayoutDocumentContent {
  const content = row.layout as PersistedDashboardLayoutContent
  return normalizeDashboardLayoutDocumentContent({
    layout: content.layout,
    widgets: content.widgets,
    colorPairs: row.color_pair as PersistedColorPairsState,
  })
}

function sortLayoutRows(rows: LayoutRow[]): LayoutRow[] {
  return [...rows].sort(
    (left, right) =>
      readLayoutSortOrder(left) - readLayoutSortOrder(right) ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id)
  )
}

async function refreshLayoutList(scope: DashboardLayoutOwnerScope): Promise<void> {
  await refreshEntityListSession('dashboard_layout', scope.workspaceId, scope.ownerUserId).catch(
    () => undefined
  )
}

async function readDashboardLayoutRows(
  scope: DashboardLayoutOwnerScope,
  store: DashboardLayoutReadStore = db
): Promise<LayoutRow[]> {
  return store
    .select()
    .from(layoutMap)
    .where(ownedWhere(scope))
    .orderBy(asc(layoutMap.sort_order), asc(layoutMap.createdAt), asc(layoutMap.id))
}

async function readOwnedLayoutRow(scope: DashboardLayoutOwnerScope, layoutId: string) {
  const [row] = await db.select().from(layoutMap).where(ownedWhere(scope, layoutId)).limit(1)

  if (!row) {
    throw new DashboardLayoutOperationError(404, 'Layout not found')
  }
  return row
}

export async function listDashboardLayouts(scope: DashboardLayoutOwnerScope) {
  return (await readDashboardLayoutRows(scope)).map(toLayoutTab)
}

export async function readPersistedDashboardLayoutContent(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<DashboardLayoutDocumentContent> {
  return rowToContent(await readOwnedLayoutRow(scope, layoutId))
}

export async function readDashboardLayoutMetadata(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<{ name: string; isActive: boolean; sortOrder: number }> {
  const row = await readOwnedLayoutRow(scope, layoutId)
  return {
    name: row.name,
    isActive: row.isActive,
    sortOrder: readLayoutSortOrder(row),
  }
}

export async function createDashboardLayout(
  scope: DashboardLayoutOwnerScope,
  options?: { name?: string; isActive?: boolean }
): Promise<DashboardLayoutProjection> {
  const created = await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    return insertDashboardLayoutRow(tx, scope, rows, options)
  })

  await refreshLayoutList(scope)
  return projectLayoutRow(created.row)
}

export async function readActiveDashboardLayoutProjection(scope: DashboardLayoutOwnerScope) {
  const orderedRows = sortLayoutRows(await readDashboardLayoutRows(scope))
  const active = orderedRows.find((row) => row.isActive) ?? orderedRows[0]
  return {
    activeLayout: active ? projectLayoutRow(active) : null,
    layouts: orderedRows.map(toLayoutTab),
  }
}

export async function provisionDashboardLayoutForWorkspaceUserInTx(
  tx: DashboardLayoutWriteStore,
  scope: DashboardLayoutOwnerScope
): Promise<boolean> {
  await lockDashboardLayoutOwner(tx, scope)
  const orderedRows = sortLayoutRows(await readDashboardLayoutRows(scope, tx))
  if (orderedRows.length > 0) return false

  await insertDashboardLayoutRow(tx, scope, [], {
    name: 'Default Layout',
    isActive: true,
  })
  return true
}

export async function ensureDashboardLayoutProvisioned(
  scope: DashboardLayoutOwnerScope
): Promise<void> {
  const provisioned = await db.transaction((tx) =>
    provisionDashboardLayoutForWorkspaceUserInTx(tx, scope)
  )
  if (provisioned) {
    await refreshLayoutList(scope)
  }
}

export async function activateDashboardLayout(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<void> {
  await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    if (!rows.some((row) => row.id === layoutId)) {
      throw new DashboardLayoutOperationError(404, 'Layout not found')
    }
    await Promise.all(
      rows.map((row) =>
        tx
          .update(layoutMap)
          .set({ isActive: row.id === layoutId, updatedAt: new Date() })
          .where(ownedWhere(scope, row.id))
      )
    )
  })
  await refreshLayoutList(scope)
}

export async function reorderDashboardLayout(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  sortOrder: number
): Promise<void> {
  await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = sortLayoutRows(await readDashboardLayoutRows(scope, tx))
    const sourceIndex = rows.findIndex((row) => row.id === layoutId)
    if (sourceIndex < 0) throw new DashboardLayoutOperationError(404, 'Layout not found')
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder >= rows.length) {
      throw new DashboardLayoutOperationError(400, 'sortOrder is out of range')
    }
    const [moved] = rows.splice(sourceIndex, 1)
    if (moved) rows.splice(sortOrder, 0, moved)
    await Promise.all(
      rows.map((row, index) =>
        tx
          .update(layoutMap)
          .set({ sort_order: index, updatedAt: new Date() })
          .where(ownedWhere(scope, row.id))
      )
    )
  })
  await refreshLayoutList(scope)
}

async function withDashboardLayoutOwnerLock<T>(
  scope: DashboardLayoutOwnerScope,
  callback: (tx: DashboardLayoutWriteStore) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockDashboardLayoutOwner(tx, scope)
    return callback(tx)
  })
}

async function lockDashboardLayoutOwner(
  tx: Pick<typeof db, 'execute'>,
  scope: DashboardLayoutOwnerScope
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${DASHBOARD_LAYOUT_OWNER_LOCK_NAMESPACE}, hashtext(${`${scope.workspaceId}:${scope.ownerUserId}`}))`
  )
}

async function insertDashboardLayoutRow(
  tx: DashboardLayoutWriteStore,
  scope: DashboardLayoutOwnerScope,
  rows: LayoutRow[],
  options?: { name?: string; isActive?: boolean }
) {
  const highestSortOrder = rows.reduce((max, row) => Math.max(max, readLayoutSortOrder(row)), -1)
  const content = createDefaultDashboardLayoutContent()
  const makeActive = options?.isActive === true

  if (makeActive) {
    await tx
      .update(layoutMap)
      .set({ isActive: false, updatedAt: new Date() })
      .where(ownedWhere(scope))
  }

  const [row] = await tx
    .insert(layoutMap)
    .values({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      userId: scope.ownerUserId,
      name: options?.name?.trim() || `Layout ${rows.length + 1}`,
      sort_order: highestSortOrder + 1,
      layout: {
        layout: content.layout,
        widgets: content.widgets,
      } satisfies PersistedDashboardLayoutContent,
      color_pair: content.colorPairs,
      isActive: makeActive,
    })
    .returning()

  return { row }
}

function projectLayoutRow(row: LayoutRow): DashboardLayoutProjection {
  return {
    ...toLayoutTab(row),
    topology: rowToContent(row).layout,
  }
}

export async function materializeDashboardLayoutContent(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  fields: DashboardLayoutDocumentContent
): Promise<DashboardLayoutDocumentContent> {
  const content = normalizeDashboardLayoutDocumentContent(fields)
  const [row] = await db
    .update(layoutMap)
    .set({
      layout: { layout: content.layout, widgets: content.widgets },
      color_pair: content.colorPairs,
      updatedAt: new Date(),
    })
    .where(ownedWhere(scope, layoutId))
    .returning()
  if (!row) throw new DashboardLayoutOperationError(404, 'Layout not found')
  await refreshLayoutList(scope)
  return rowToContent(row)
}

export async function deleteDashboardLayout(scope: DashboardLayoutOwnerScope, layoutId: string) {
  await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const [row] = await tx.select().from(layoutMap).where(ownedWhere(scope, layoutId)).limit(1)
    if (!row) {
      throw new DashboardLayoutOperationError(404, 'Layout not found')
    }
    if (row.isActive) {
      throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
    }

    await tx.delete(layoutMap).where(ownedWhere(scope, layoutId))
  })
  await refreshLayoutList(scope)
  await deleteYjsSessionInSocketServer(layoutId).catch(() => undefined)
}
