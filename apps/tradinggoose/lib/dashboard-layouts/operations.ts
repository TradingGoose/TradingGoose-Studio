import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMaps, layoutPairs, layoutWidgets } from '@tradinggoose/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  buildDashboardColorPairSessionId,
  buildDashboardWidgetSessionId,
} from '@/lib/copilot/review-sessions/identity'
import {
  beginRealtimeMutationTransaction,
  type RealtimeMutation,
} from '@/lib/yjs/server/mutation-idempotency'
import {
  refreshEntityListSession,
  runYjsDrainFencedTransaction,
} from '@/lib/yjs/server/snapshot-bridge'
import type { PairColorContext } from '@/widgets/color-pairs'
import type { LinkedPairColor } from '@/widgets/layout'
import {
  createDefaultDashboardLayoutProjection,
  type DashboardLayoutDocument,
  type DashboardLayoutEditPlan,
  type DashboardLayoutProjectionContent,
  type DashboardLayoutTopologyNode,
  type DashboardWidgetDocument,
  materializeDashboardWidgetBinding,
  normalizeDashboardColorPairDocument,
  normalizeDashboardLayoutTopology,
  normalizeDashboardWidgetDocument,
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
  createdAt?: string
  updatedAt: string
}

export type DashboardLayoutProjection = DashboardLayoutTab & {
  topology: DashboardLayoutTopologyNode
}

type DashboardLayoutStructuralCommit = DashboardLayoutEditPlan & {
  retainedSourceDocuments: ReadonlyMap<string, DashboardWidgetDocument>
}

type LayoutRow = typeof layoutMaps.$inferSelect
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
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function nextDashboardLayoutRevision(
  layouts: readonly { updatedAt: Date | string }[]
): Date {
  const timestamps = layouts.map(({ updatedAt }) =>
    typeof updatedAt === 'string' ? Date.parse(updatedAt) : updatedAt.getTime()
  )
  return new Date(Math.max(Date.now(), ...timestamps.map((timestamp) => timestamp + 1)))
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
      409,
      error instanceof Error ? error.message : `Layout ${row.id} topology is invalid`
    )
  }
}

function requireDashboardWidgetKey(row: LayoutRow, identityId: string) {
  const pending = [normalizePersistedTopology(row)]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === 'panel' && node.identityId === identityId) return node.widgetKey
    if (node.type === 'group') pending.push(...node.children)
  }
  throw new DashboardLayoutOperationError(404, 'Dashboard widget binding not found')
}

async function refreshLayoutList(scope: DashboardLayoutOwnerScope): Promise<void> {
  await refreshEntityListSession('dashboard_layout', scope.workspaceId, scope.ownerUserId)
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

export async function listDashboardLayouts(
  scope: DashboardLayoutOwnerScope,
  store: DashboardLayoutReadStore = db
) {
  return (await readDashboardLayoutRows(scope, store)).map(toLayoutTab)
}

export async function readPersistedDashboardLayoutDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  store: DashboardLayoutReadStore = db
): Promise<DashboardLayoutDocument> {
  const row = await readOwnedLayoutRow(scope, layoutId, store)
  return { layout: normalizePersistedTopology(row) }
}

export async function readPersistedDashboardWidgetBinding(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  identityId: string,
  store: DashboardLayoutReadStore = db
): Promise<{
  widgetKey: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey']
  document: DashboardWidgetDocument
}> {
  const [result] = await store
    .select({ layout: layoutMaps, widget: layoutWidgets })
    .from(layoutMaps)
    .leftJoin(
      layoutWidgets,
      and(eq(layoutWidgets.layoutId, layoutMaps.id), eq(layoutWidgets.id, identityId))
    )
    .where(ownedWhere(scope, layoutId))
    .limit(1)
  if (!result) throw new DashboardLayoutOperationError(404, 'Layout not found')
  const widgetKey = requireDashboardWidgetKey(result.layout, identityId)
  if (!result.widget) throw new DashboardLayoutOperationError(404, 'Dashboard widget not found')
  return {
    widgetKey,
    document: normalizeDashboardWidgetDocument(widgetKey, {
      pairColor: result.widget.pairColor,
      params: result.widget.params,
    }),
  }
}

export async function readPersistedDashboardColorPairDocument(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  color: string,
  store: DashboardLayoutReadStore = db
): Promise<PairColorContext> {
  await readOwnedLayoutRow(scope, layoutId, store)
  if (!isPairColor(color) || color === 'gray') {
    throw new DashboardLayoutOperationError(400, `Invalid dashboard pair color ${color}`)
  }
  const [row] = await store
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
  options?: { name?: string; beforeInsert?: (layouts: readonly DashboardLayoutTab[]) => void }
): Promise<DashboardLayoutProjection & { content: DashboardLayoutProjectionContent }> {
  const created = await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    options?.beforeInsert?.(sortLayoutRows(rows).map(toLayoutTab))
    return insertDashboardLayoutRow(tx, scope, rows, options)
  })
  await refreshLayoutList(scope)
  return { ...projectLayoutRow(created.row), content: created.content }
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
    const updatedAt = nextDashboardLayoutRevision(rows)
    await Promise.all(
      rows.map((row) =>
        tx
          .update(layoutMaps)
          .set({ isActive: row.id === layoutId, updatedAt })
          .where(ownedWhere(scope, row.id))
      )
    )
  })
  await refreshLayoutList(scope)
}

export async function reorderDashboardLayouts(
  scope: DashboardLayoutOwnerScope,
  layoutOrder: string[]
): Promise<void> {
  await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    const remainingIds = new Set(rows.map((row) => row.id))
    if (layoutOrder.length !== rows.length || layoutOrder.some((id) => !remainingIds.delete(id))) {
      throw new DashboardLayoutOperationError(400, 'layoutOrder must contain every layout once')
    }
    const updatedAt = nextDashboardLayoutRevision(rows)
    await Promise.all(
      layoutOrder.map((id, index) =>
        tx.update(layoutMaps).set({ sortOrder: index, updatedAt }).where(ownedWhere(scope, id))
      )
    )
  })
  await refreshLayoutList(scope)
}

export async function withDashboardLayoutOwnerLock<T>(
  scope: DashboardLayoutOwnerScope,
  callback: (tx: DashboardLayoutWriteStore) => Promise<T>,
  tx?: DashboardLayoutWriteStore,
  mutation?: RealtimeMutation
): Promise<T> {
  const mutate = async (store: DashboardLayoutWriteStore) => {
    const complete = mutation
      ? await beginRealtimeMutationTransaction(store, mutation, 60_000)
      : undefined
    await lockDashboardLayoutOwner(store, scope)
    const result = await callback(store)
    return complete ? complete(result) : result
  }
  return tx ? mutate(tx) : db.transaction(mutate)
}

export async function lockDashboardLayoutOwner(
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
): Promise<{ row: LayoutRow; content: DashboardLayoutProjectionContent }> {
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
      updatedAt: nextDashboardLayoutRevision(rows),
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
  return { row, content: projection }
}

function projectLayoutRow(row: LayoutRow): DashboardLayoutProjection {
  return { ...toLayoutTab(row), topology: normalizePersistedTopology(row) }
}

export async function commitDashboardLayoutStructure(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  commit: DashboardLayoutStructuralCommit,
  tx?: DashboardLayoutWriteStore,
  mutation?: RealtimeMutation
) {
  const layout = normalizeDashboardLayoutTopology(commit.layout)
  const removedIdentityIds = [...new Set(commit.removedIdentityIds)]
  if (removedIdentityIds.length > 0 && !tx) {
    throw new DashboardLayoutOperationError(500, 'Widget removal requires a revocation transaction')
  }

  return withDashboardLayoutOwnerLock(
    scope,
    async (store) => {
      const rows = await readDashboardLayoutRows(scope, store)
      const createdRows = []
      const createdWidgets: Record<string, DashboardWidgetDocument> = {}
      for (const binding of commit.createdBindings) {
        const sourceId = binding.source?.identityId
        const sourceDocument =
          sourceId && removedIdentityIds.includes(sourceId)
            ? (await readPersistedDashboardWidgetBinding(scope, layoutId, sourceId, store)).document
            : sourceId
              ? commit.retainedSourceDocuments.get(sourceId)
              : undefined
        const document = materializeDashboardWidgetBinding(binding, sourceDocument)
        createdWidgets[binding.identityId] = document
        createdRows.push({
          id: binding.identityId,
          layoutId,
          ...document,
        })
      }
      const updated = await store
        .update(layoutMaps)
        .set({ layout, updatedAt: nextDashboardLayoutRevision(rows) })
        .where(ownedWhere(scope, layoutId))
        .returning({ id: layoutMaps.id })
      if (updated.length === 0) throw new DashboardLayoutOperationError(404, 'Layout not found')
      if (createdRows.length > 0) await store.insert(layoutWidgets).values(createdRows)
      if (removedIdentityIds.length > 0) {
        await store
          .delete(layoutWidgets)
          .where(
            and(eq(layoutWidgets.layoutId, layoutId), inArray(layoutWidgets.id, removedIdentityIds))
          )
      }
      return { createdWidgets }
    },
    tx,
    mutation
  )
}

async function writeDashboardColorPairDocument(
  store: DashboardLayoutWriteStore,
  layoutId: string,
  color: LinkedPairColor,
  document: PairColorContext
): Promise<void> {
  if (Object.keys(document).length === 0) {
    await store
      .delete(layoutPairs)
      .where(and(eq(layoutPairs.layoutId, layoutId), eq(layoutPairs.color, color)))
    return
  }
  await store
    .insert(layoutPairs)
    .values({ layoutId, color, context: document })
    .onConflictDoUpdate({
      target: [layoutPairs.layoutId, layoutPairs.color],
      set: { context: document },
    })
}

export async function persistDashboardWidgetAndColorPairDocuments(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  commit: {
    widget?: { identityId: string; content: DashboardWidgetDocument }
    colorPair?: { color: string; content: PairColorContext }
  },
  mutation?: RealtimeMutation
): Promise<{ widget?: DashboardWidgetDocument; colorPair?: PairColorContext }> {
  if (!commit.widget && !commit.colorPair && !mutation) {
    throw new DashboardLayoutOperationError(400, 'Dashboard document commit is empty')
  }
  return db.transaction(async (tx) => {
    const complete = await beginRealtimeMutationTransaction(tx, mutation, 30_000)
    const layout = await readOwnedLayoutRow(scope, layoutId, tx)
    const result: { widget?: DashboardWidgetDocument; colorPair?: PairColorContext } = {}
    if (commit.widget) {
      const { identityId, content } = commit.widget
      const normalized = normalizeDashboardWidgetDocument(
        requireDashboardWidgetKey(layout, identityId),
        content
      )
      const rows = await tx
        .update(layoutWidgets)
        .set({ pairColor: normalized.pairColor, params: normalized.params })
        .where(and(eq(layoutWidgets.layoutId, layoutId), eq(layoutWidgets.id, identityId)))
        .returning({ id: layoutWidgets.id })
      if (rows.length === 0) {
        throw new DashboardLayoutOperationError(404, 'Dashboard widget not found')
      }
      result.widget = normalized
    }
    if (commit.colorPair) {
      const { color, content } = commit.colorPair
      if (!isPairColor(color) || color === 'gray') {
        throw new DashboardLayoutOperationError(400, `Invalid dashboard pair color ${color}`)
      }
      const normalized = normalizeDashboardColorPairDocument(content)
      await writeDashboardColorPairDocument(tx, layoutId, color, normalized)
      result.colorPair = normalized
    }
    return complete(result)
  })
}

export async function deleteDashboardLayout(scope: DashboardLayoutOwnerScope, layoutId: string) {
  const row = await readOwnedLayoutRow(scope, layoutId)
  if (row.isActive) throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
  await runYjsDrainFencedTransaction({ sessionIds: [layoutId] }, async (layoutTx) => {
    const widgets = await layoutTx
      .select({ id: layoutWidgets.id })
      .from(layoutWidgets)
      .where(eq(layoutWidgets.layoutId, layoutId))
    const childSessionIds = [
      ...widgets.map(({ id }) => buildDashboardWidgetSessionId(layoutId, id)),
      ...PAIR_COLORS.filter((color) => color !== 'gray').map((color) =>
        buildDashboardColorPairSessionId(layoutId, color)
      ),
    ]
    await runYjsDrainFencedTransaction(
      { sessionIds: childSessionIds },
      async (tx) => {
        await lockDashboardLayoutOwner(tx, scope)
        const rows = await readDashboardLayoutRows(scope, tx)
        const current = rows.find((layout) => layout.id === layoutId)
        if (!current) throw new DashboardLayoutOperationError(404, 'Layout not found')
        if (current.isActive) {
          throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
        }
        await tx
          .update(layoutMaps)
          .set({ updatedAt: nextDashboardLayoutRevision(rows) })
          .where(ownedWhere(scope))
        await tx.delete(layoutMaps).where(ownedWhere(scope, layoutId))
      },
      layoutTx
    )
  })
  await refreshLayoutList(scope)
}
