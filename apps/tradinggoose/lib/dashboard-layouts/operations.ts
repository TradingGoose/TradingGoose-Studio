import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMaps, layoutPairs, layoutWidgets } from '@tradinggoose/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { isEqual } from 'lodash'
import {
  buildDashboardColorPairSessionId,
  buildDashboardWidgetSessionId,
} from '@/lib/copilot/review-sessions/identity'
import {
  refreshEntityListSession,
  withYjsSessionDeletionLease,
} from '@/lib/yjs/server/snapshot-bridge'
import type { PairColorContext } from '@/widgets/color-pairs'
import {
  type LinkedPairColor,
  normalizePersistedColorPairFields,
  PERSISTED_COLOR_PAIR_FIELDS,
  type PersistedColorPair,
} from '@/widgets/layout'
import {
  createDefaultDashboardLayoutProjection,
  type DashboardLayoutDocument,
  type DashboardLayoutProjectionContent,
  type DashboardLayoutTopologyNode,
  type DashboardWidgetBindingCreation,
  type DashboardWidgetDocument,
  normalizeDashboardColorPairDocument,
  normalizeDashboardLayoutProjection,
  normalizeDashboardLayoutTopology,
  normalizeDashboardWidgetDocument,
  normalizeDashboardWidgetStorageDocument,
} from '@/widgets/layout-document'
import { isPairColor, PAIR_COLORS } from '@/widgets/pair-colors'

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

export type DashboardLayoutStructuralCommit = {
  layout: DashboardLayoutTopologyNode
  createdWidgets: Array<{
    binding: DashboardWidgetBindingCreation
    document: DashboardWidgetDocument
  }>
  removedIdentityIds: string[]
}

type LayoutRow = typeof layoutMaps.$inferSelect
type LayoutWidgetRow = typeof layoutWidgets.$inferSelect
type LayoutPairRow = typeof layoutPairs.$inferSelect
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
    ...(layoutId === undefined ? [] : [eq(layoutMaps.id, layoutId)]),
    eq(layoutMaps.workspaceId, scope.workspaceId),
    eq(layoutMaps.userId, scope.ownerUserId)
  )

function readLayoutSortOrder(row: LayoutRow): number {
  if (typeof row.sortOrder !== 'number' || !Number.isFinite(row.sortOrder)) {
    throw new DashboardLayoutOperationError(500, `Layout ${row.id} is missing sort_order`)
  }
  return row.sortOrder
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

function sortLayoutRows(rows: LayoutRow[]): LayoutRow[] {
  return [...rows].sort(
    (left, right) =>
      readLayoutSortOrder(left) - readLayoutSortOrder(right) ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id)
  )
}

function normalizePersistedTopology(row: LayoutRow): DashboardLayoutTopologyNode {
  try {
    return normalizeDashboardLayoutTopology(row.layout)
  } catch (error) {
    throw new DashboardLayoutOperationError(
      500,
      error instanceof Error ? error.message : `Layout ${row.id} topology is invalid`
    )
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function decodePairRow(row: LayoutPairRow): PersistedColorPair {
  if (!isPairColor(row.color) || row.color === 'gray') {
    throw new DashboardLayoutOperationError(500, `Layout pair ${row.color} has an invalid color`)
  }
  if (!isPlainRecord(row.context)) {
    throw new DashboardLayoutOperationError(
      500,
      `Layout pair ${row.color} context must be an object`
    )
  }
  const allowedFields = new Set<string>(PERSISTED_COLOR_PAIR_FIELDS)
  const invalidField = Object.keys(row.context).find((field) => !allowedFields.has(field))
  const normalized = normalizePersistedColorPairFields(row.context)
  if (invalidField || Object.keys(normalized).length === 0 || !isEqual(row.context, normalized)) {
    throw new DashboardLayoutOperationError(
      500,
      `Layout pair ${row.color} context is not canonical`
    )
  }
  return { color: row.color as LinkedPairColor, ...normalized }
}

function assembleLayoutProjection(
  row: LayoutRow,
  widgetRows: LayoutWidgetRow[],
  pairRows: LayoutPairRow[]
): DashboardLayoutProjectionContent {
  try {
    return normalizeDashboardLayoutProjection({
      layout: row.layout,
      widgets: Object.fromEntries(
        widgetRows.map((widget) => [
          widget.id,
          { pairColor: widget.pairColor, params: widget.params },
        ])
      ),
      colorPairs: { pairs: pairRows.map(decodePairRow) },
    })
  } catch (error) {
    throw new DashboardLayoutOperationError(
      500,
      error instanceof Error ? error.message : `Layout ${row.id} projection is invalid`
    )
  }
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
    .from(layoutMaps)
    .where(ownedWhere(scope))
    .orderBy(asc(layoutMaps.sortOrder), asc(layoutMaps.createdAt), asc(layoutMaps.id))
}

async function readOwnedLayoutRow(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  store: DashboardLayoutReadStore = db
): Promise<LayoutRow> {
  const [row] = await store.select().from(layoutMaps).where(ownedWhere(scope, layoutId)).limit(1)
  if (!row) throw new DashboardLayoutOperationError(404, 'Layout not found')
  return row
}

export async function listDashboardLayouts(scope: DashboardLayoutOwnerScope) {
  return (await readDashboardLayoutRows(scope)).map(toLayoutTab)
}

export async function readPersistedDashboardLayoutDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<DashboardLayoutDocument> {
  const row = await readOwnedLayoutRow(scope, layoutId)
  return { layout: normalizePersistedTopology(row) }
}

export async function readPersistedDashboardLayoutProjection(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<DashboardLayoutProjectionContent> {
  return db.transaction(
    async (tx) => {
      const row = await readOwnedLayoutRow(scope, layoutId, tx)
      const [widgetRows, pairRows] = await Promise.all([
        tx
          .select()
          .from(layoutWidgets)
          .where(eq(layoutWidgets.layoutId, row.id))
          .orderBy(asc(layoutWidgets.id)),
        tx
          .select()
          .from(layoutPairs)
          .where(eq(layoutPairs.layoutId, row.id))
          .orderBy(asc(layoutPairs.color)),
      ])
      return assembleLayoutProjection(row, widgetRows, pairRows)
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
}

export async function readPersistedDashboardWidgetDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  identityId: string
): Promise<DashboardWidgetDocument> {
  await readOwnedLayoutRow(scope, layoutId)
  const [row] = await db
    .select()
    .from(layoutWidgets)
    .where(and(eq(layoutWidgets.layoutId, layoutId), eq(layoutWidgets.id, identityId)))
    .limit(1)
  if (!row) throw new DashboardLayoutOperationError(404, 'Dashboard widget not found')
  return normalizeDashboardWidgetStorageDocument({
    pairColor: row.pairColor,
    params: row.params,
  })
}

export async function readPersistedDashboardColorPairDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  color: string
): Promise<PairColorContext> {
  await readOwnedLayoutRow(scope, layoutId)
  if (!isPairColor(color) || color === 'gray') {
    throw new DashboardLayoutOperationError(400, `Invalid dashboard pair color ${color}`)
  }
  const [row] = await db
    .select()
    .from(layoutPairs)
    .where(and(eq(layoutPairs.layoutId, layoutId), eq(layoutPairs.color, color)))
    .limit(1)
  return row ? normalizeDashboardColorPairDocument(row.context) : {}
}

export async function readDashboardLayoutMetadata(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<{ name: string; isActive: boolean; sortOrder: number }> {
  const row = await readOwnedLayoutRow(scope, layoutId)
  return { name: row.name, isActive: row.isActive, sortOrder: readLayoutSortOrder(row) }
}

export async function createDashboardLayout(
  scope: DashboardLayoutOwnerScope,
  options?: { name?: string }
): Promise<DashboardLayoutProjection> {
  const created = await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    return insertDashboardLayoutRow(tx, scope, rows, options)
  })
  await refreshLayoutList(scope)
  return projectLayoutRow(created)
}

export async function readActiveDashboardLayoutProjection(scope: DashboardLayoutOwnerScope) {
  const orderedRows = sortLayoutRows(await readDashboardLayoutRows(scope))
  const active = orderedRows.find((row) => row.isActive)
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
  await insertDashboardLayoutRow(tx, scope, [], { name: 'Default Layout' })
  return true
}

export async function ensureDashboardLayoutProvisioned(
  scope: DashboardLayoutOwnerScope
): Promise<void> {
  const provisioned = await db.transaction((tx) =>
    provisionDashboardLayoutForWorkspaceUserInTx(tx, scope)
  )
  if (provisioned) await refreshLayoutList(scope)
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
          .update(layoutMaps)
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
          .update(layoutMaps)
          .set({ sortOrder: index, updatedAt: new Date() })
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
  options?: { name?: string }
): Promise<LayoutRow> {
  const highestSortOrder = rows.reduce((max, row) => Math.max(max, readLayoutSortOrder(row)), -1)
  const projection = createDefaultDashboardLayoutProjection()
  const layoutId = randomUUID()
  const [row] = await tx
    .insert(layoutMaps)
    .values({
      id: layoutId,
      workspaceId: scope.workspaceId,
      userId: scope.ownerUserId,
      name: options?.name?.trim() || `Layout ${rows.length + 1}`,
      sortOrder: highestSortOrder + 1,
      layout: projection.layout,
      isActive: rows.length === 0,
    })
    .returning()
  if (!row) throw new DashboardLayoutOperationError(500, 'Layout insert did not return a row')
  const widgetValues = Object.entries(projection.widgets).map(([id, widget]) => ({
    id,
    layoutId,
    pairColor: widget.pairColor,
    params: widget.params,
  }))
  if (widgetValues.length > 0) await tx.insert(layoutWidgets).values(widgetValues)
  return row
}

function projectLayoutRow(row: LayoutRow): DashboardLayoutProjection {
  return { ...toLayoutTab(row), topology: normalizePersistedTopology(row) }
}

export async function commitDashboardLayoutStructure(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  commit: DashboardLayoutStructuralCommit
): Promise<DashboardLayoutDocument> {
  const layout = normalizeDashboardLayoutTopology(commit.layout)
  const createdWidgets = commit.createdWidgets.map(({ binding, document }) => ({
    id: binding.identityId,
    layoutId,
    ...normalizeDashboardWidgetDocument(binding.widgetKey, document),
  }))
  const removedIdentityIds = [...new Set(commit.removedIdentityIds)]

  await db.transaction(async (tx) => {
    await readOwnedLayoutRow(scope, layoutId, tx)
    if (createdWidgets.length > 0) await tx.insert(layoutWidgets).values(createdWidgets)
    const updated = await tx
      .update(layoutMaps)
      .set({ layout, updatedAt: new Date() })
      .where(ownedWhere(scope, layoutId))
      .returning({ id: layoutMaps.id })
    if (updated.length === 0) throw new DashboardLayoutOperationError(404, 'Layout not found')
    if (removedIdentityIds.length > 0) {
      await tx
        .delete(layoutWidgets)
        .where(
          and(eq(layoutWidgets.layoutId, layoutId), inArray(layoutWidgets.id, removedIdentityIds))
        )
    }
  })
  await refreshLayoutList(scope)
  return { layout }
}

export async function persistDashboardWidgetDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  identityId: string,
  content: DashboardWidgetDocument
): Promise<DashboardWidgetDocument> {
  await readOwnedLayoutRow(scope, layoutId)
  const normalized = normalizeDashboardWidgetStorageDocument(content)
  const rows = await db
    .update(layoutWidgets)
    .set({ pairColor: normalized.pairColor, params: normalized.params })
    .where(and(eq(layoutWidgets.layoutId, layoutId), eq(layoutWidgets.id, identityId)))
    .returning({ id: layoutWidgets.id })
  if (rows.length === 0) throw new DashboardLayoutOperationError(404, 'Dashboard widget not found')
  return normalized
}

export async function persistDashboardColorPairDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  color: string,
  content: PairColorContext
): Promise<PairColorContext> {
  await readOwnedLayoutRow(scope, layoutId)
  if (!isPairColor(color) || color === 'gray') {
    throw new DashboardLayoutOperationError(400, `Invalid dashboard pair color ${color}`)
  }
  const normalized = normalizeDashboardColorPairDocument(content)
  if (Object.keys(normalized).length === 0) {
    await db
      .delete(layoutPairs)
      .where(and(eq(layoutPairs.layoutId, layoutId), eq(layoutPairs.color, color)))
    return normalized
  }
  await db
    .insert(layoutPairs)
    .values({ layoutId, color, context: normalized })
    .onConflictDoUpdate({
      target: [layoutPairs.layoutId, layoutPairs.color],
      set: { context: normalized },
    })
  return normalized
}

export async function deleteDashboardLayout(scope: DashboardLayoutOwnerScope, layoutId: string) {
  const row = await readOwnedLayoutRow(scope, layoutId)
  if (row.isActive) throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
  await withYjsSessionDeletionLease([layoutId], async () => {
    const widgets = await db
      .select({ id: layoutWidgets.id })
      .from(layoutWidgets)
      .where(eq(layoutWidgets.layoutId, layoutId))
    const childSessionIds = [
      ...widgets.map(({ id }) => buildDashboardWidgetSessionId(layoutId, id)),
      ...PAIR_COLORS.filter((color) => color !== 'gray').map((color) =>
        buildDashboardColorPairSessionId(layoutId, color)
      ),
    ]
    await withYjsSessionDeletionLease(childSessionIds, () =>
      withDashboardLayoutOwnerLock(scope, async (tx) => {
        const current = await readOwnedLayoutRow(scope, layoutId, tx)
        if (current.isActive) {
          throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
        }
        await tx.delete(layoutMaps).where(ownedWhere(scope, layoutId))
      })
    )
  })
  await refreshLayoutList(scope)
}
