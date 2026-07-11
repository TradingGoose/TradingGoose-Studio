import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMaps, layoutPairs, layoutWidgets } from '@tradinggoose/db/schema'
import { and, asc, eq, notInArray, sql } from 'drizzle-orm'
import { isEqual } from 'lodash'
import type * as Y from 'yjs'
import {
  type DashboardLayoutDirtyBatch,
  readDashboardLayoutContent,
} from '@/lib/yjs/dashboard-layout-session'
import {
  deleteYjsSessionInSocketServer,
  refreshEntityListSession,
} from '@/lib/yjs/server/snapshot-bridge'
import {
  type LinkedPairColor,
  normalizePersistedColorPairFields,
  PERSISTED_COLOR_PAIR_FIELDS,
  type PersistedColorPair,
} from '@/widgets/layout'
import {
  createDefaultDashboardLayoutContent,
  type DashboardLayoutDocumentContent,
  type DashboardLayoutTopologyNode,
  type DashboardWidgetDocument,
  normalizeDashboardLayoutDocumentContent,
  normalizeDashboardLayoutTopology,
} from '@/widgets/layout-document'
import { isPairColor } from '@/widgets/pair-colors'

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

function toWidgetsState(rows: LayoutWidgetRow[]): Record<string, DashboardWidgetDocument> {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        pairColor: row.pairColor,
        params: row.params,
      },
    ])
  ) as Record<string, DashboardWidgetDocument>
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

  const context = row.context
  const allowedFields = new Set<string>(PERSISTED_COLOR_PAIR_FIELDS)
  const invalidField = Object.keys(context).find((field) => !allowedFields.has(field))
  if (invalidField) {
    throw new DashboardLayoutOperationError(
      500,
      `Layout pair ${row.color} context contains unsupported field ${invalidField}`
    )
  }

  const normalized = normalizePersistedColorPairFields(context)
  if (Object.keys(normalized).length === 0 || !isEqual(context, normalized)) {
    throw new DashboardLayoutOperationError(
      500,
      `Layout pair ${row.color} context is not canonical`
    )
  }

  return { color: row.color as LinkedPairColor, ...normalized }
}

function assembleLayoutContent(
  row: LayoutRow,
  widgetRows: LayoutWidgetRow[],
  pairRows: LayoutPairRow[]
): DashboardLayoutDocumentContent {
  try {
    return normalizeDashboardLayoutDocumentContent({
      layout: row.layout,
      widgets: toWidgetsState(widgetRows),
      colorPairs: { pairs: pairRows.map(decodePairRow) },
    })
  } catch (error) {
    if (error instanceof DashboardLayoutOperationError) throw error
    throw new DashboardLayoutOperationError(
      500,
      error instanceof Error ? error.message : `Layout ${row.id} content is invalid`
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

export async function readPersistedDashboardLayoutContent(
  scope: DashboardLayoutOwnerScope,
  layoutId: string
): Promise<DashboardLayoutDocumentContent> {
  return db.transaction(
    async (tx) => {
      const row = await readOwnedLayoutRow(scope, layoutId, tx)
      const widgetRows = await tx
        .select()
        .from(layoutWidgets)
        .where(eq(layoutWidgets.layoutId, row.id))
        .orderBy(asc(layoutWidgets.id))
      const pairRows = await tx
        .select()
        .from(layoutPairs)
        .where(eq(layoutPairs.layoutId, row.id))
        .orderBy(asc(layoutPairs.color))
      return assembleLayoutContent(row, widgetRows, pairRows)
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
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
  const content = createDefaultDashboardLayoutContent()
  const layoutId = randomUUID()
  const isActive = rows.length === 0

  const [row] = await tx
    .insert(layoutMaps)
    .values({
      id: layoutId,
      workspaceId: scope.workspaceId,
      userId: scope.ownerUserId,
      name: options?.name?.trim() || `Layout ${rows.length + 1}`,
      sortOrder: highestSortOrder + 1,
      layout: content.layout,
      isActive,
    })
    .returning()
  if (!row) throw new DashboardLayoutOperationError(500, 'Layout insert did not return a row')

  const widgetValues = Object.entries(content.widgets).map(([id, widget]) => ({
    id,
    layoutId,
    pairColor: widget.pairColor,
    params: widget.params,
  }))
  if (widgetValues.length > 0) await tx.insert(layoutWidgets).values(widgetValues)

  const pairValues = content.colorPairs.pairs.map(({ color, ...context }) => ({
    layoutId,
    color,
    context,
  }))
  if (pairValues.length > 0) await tx.insert(layoutPairs).values(pairValues)

  return row
}

function projectLayoutRow(row: LayoutRow): DashboardLayoutProjection {
  return {
    ...toLayoutTab(row),
    topology: normalizePersistedTopology(row),
  }
}

async function touchLayoutInTx(
  tx: DashboardLayoutWriteStore,
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  layout?: DashboardLayoutTopologyNode
): Promise<void> {
  const rows = await tx
    .update(layoutMaps)
    .set({ ...(layout ? { layout } : {}), updatedAt: new Date() })
    .where(ownedWhere(scope, layoutId))
    .returning({ id: layoutMaps.id })
  if (rows.length === 0) throw new DashboardLayoutOperationError(404, 'Layout not found')
}

async function persistLayoutPairsInTx(
  tx: DashboardLayoutWriteStore,
  layoutId: string,
  content: DashboardLayoutDocumentContent,
  colors: ReadonlySet<string>
): Promise<void> {
  const pairs = new Map(content.colorPairs.pairs.map((pair) => [pair.color, pair]))
  for (const color of [...colors].sort()) {
    if (!isPairColor(color) || color === 'gray') {
      throw new DashboardLayoutOperationError(400, `Invalid dashboard pair color ${color}`)
    }
    const pair = pairs.get(color)
    if (!pair) {
      await tx
        .delete(layoutPairs)
        .where(and(eq(layoutPairs.layoutId, layoutId), eq(layoutPairs.color, color)))
      continue
    }
    const { color: _color, ...context } = pair
    await tx
      .insert(layoutPairs)
      .values({ layoutId, color, context })
      .onConflictDoUpdate({
        target: [layoutPairs.layoutId, layoutPairs.color],
        set: { context },
      })
  }
}

async function persistLayoutWidgetsInTx(
  tx: DashboardLayoutWriteStore,
  layoutId: string,
  content: DashboardLayoutDocumentContent,
  identityIds: ReadonlySet<string>
): Promise<void> {
  for (const identityId of [...identityIds].sort()) {
    const widget = content.widgets[identityId]
    if (!widget) {
      await tx
        .delete(layoutWidgets)
        .where(and(eq(layoutWidgets.id, identityId), eq(layoutWidgets.layoutId, layoutId)))
      continue
    }

    const updated = await tx
      .update(layoutWidgets)
      .set({ pairColor: widget.pairColor, params: widget.params })
      .where(and(eq(layoutWidgets.id, identityId), eq(layoutWidgets.layoutId, layoutId)))
      .returning({ id: layoutWidgets.id })
    if (updated.length > 0) continue

    await tx.insert(layoutWidgets).values({
      id: identityId,
      layoutId,
      pairColor: widget.pairColor,
      params: widget.params,
    })
  }
}

async function reconcileLayoutWidgetsInTx(
  tx: DashboardLayoutWriteStore,
  layoutId: string,
  content: DashboardLayoutDocumentContent
): Promise<void> {
  const identityIds = Object.keys(content.widgets)
  await persistLayoutWidgetsInTx(tx, layoutId, content, new Set(identityIds))
  await tx
    .delete(layoutWidgets)
    .where(and(eq(layoutWidgets.layoutId, layoutId), notInArray(layoutWidgets.id, identityIds)))
}

export async function persistDashboardLayoutDirtyChannels(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  doc: Y.Doc,
  batch: DashboardLayoutDirtyBatch
): Promise<DashboardLayoutDocumentContent> {
  let content: DashboardLayoutDocumentContent
  try {
    content = readDashboardLayoutContent(doc)
  } catch (error) {
    throw new DashboardLayoutOperationError(
      400,
      error instanceof Error ? error.message : 'Dashboard layout Yjs state is invalid'
    )
  }

  await db.transaction(async (tx) => {
    await touchLayoutInTx(tx, scope, layoutId, batch.layout ? content.layout : undefined)
    if (batch.pairColors.size > 0) {
      await persistLayoutPairsInTx(tx, layoutId, content, batch.pairColors)
    }
    if (batch.layout) {
      await reconcileLayoutWidgetsInTx(tx, layoutId, content)
    } else if (batch.widgetIdentityIds.size > 0) {
      await persistLayoutWidgetsInTx(tx, layoutId, content, batch.widgetIdentityIds)
    }
  })

  await refreshLayoutList(scope)
  return content
}

export async function deleteDashboardLayout(scope: DashboardLayoutOwnerScope, layoutId: string) {
  await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const row = await readOwnedLayoutRow(scope, layoutId, tx)
    if (row.isActive) {
      throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
    }
    await tx.delete(layoutMaps).where(ownedWhere(scope, layoutId))
  })
  await refreshLayoutList(scope)
  await deleteYjsSessionInSocketServer(layoutId).catch(() => undefined)
}
