import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMap } from '@tradinggoose/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import {
  guardWorkspaceEntityDocumentDeleteInTx,
  WorkspaceEntityDocumentDeletionError,
} from '@/lib/workspaces/entity-documents'
import {
  applyEntityStateInSocketServer,
  deleteYjsSessionInSocketServer,
  refreshEntityListSession,
} from '@/lib/yjs/server/snapshot-bridge'
import {
  createDefaultColorPairsState,
  createDefaultLayoutState,
  type LayoutNode,
  type PersistedColorPairsState,
  serializeLayout,
} from '@/widgets/layout'
import { normalizeDashboardLayoutDocumentFields } from '@/widgets/layout-document'

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
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
}

export type DashboardLayoutFields = {
  name: string
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  isActive: boolean
  sortOrder: number
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

export async function createDashboardLayout(
  scope: DashboardLayoutOwnerScope,
  options?: { name?: string; isActive?: boolean }
): Promise<DashboardLayoutProjection> {
  const created = await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    return insertDashboardLayoutRow(tx, scope, rows, options)
  })

  await refreshLayoutList(scope)
  return { ...toLayoutTab(created.row), layout: created.layout, colorPairs: created.colorPairs }
}

export async function readActiveDashboardLayoutProjection(scope: DashboardLayoutOwnerScope) {
  const orderedRows = sortLayoutRows(await readDashboardLayoutRows(scope))
  const active = orderedRows.find((row) => row.isActive) ?? orderedRows[0]
  return {
    activeLayout: active ? await hydrateLayoutRow(active) : null,
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
  const layout = createDefaultLayoutState()
  const colorPairs = createDefaultColorPairsState()
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
      layout: serializeLayout(layout),
      color_pair: colorPairs,
      isActive: makeActive,
    })
    .returning()

  return { row, layout, colorPairs }
}

async function hydrateLayoutRow(row: LayoutRow): Promise<DashboardLayoutProjection> {
  const fields = layoutRowToFields(row)
  const projection = await buildDashboardLayoutReadProjection(fields)
  return {
    ...toLayoutTab(row),
    layout: projection.hydratedLayout,
    colorPairs: projection.hydratedColorPairs,
  }
}

function layoutRowToFields(row: LayoutRow): DashboardLayoutFields {
  return normalizeEntityFields('dashboard_layout', {
    name: row.name,
    layout: row.layout,
    colorPairs: row.color_pair,
    isActive: row.isActive,
    sortOrder: row.sort_order,
  }) as DashboardLayoutFields
}

async function readDashboardLayoutFields(scope: DashboardLayoutOwnerScope, layoutId: string) {
  return layoutRowToFields(await readOwnedLayoutRow(scope, layoutId))
}

export async function materializeDashboardLayoutFields(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  fields: Partial<DashboardLayoutFields>
): Promise<DashboardLayoutFields> {
  const current = await readDashboardLayoutFields(scope, layoutId)
  const normalized = normalizeDashboardLayoutDocumentFields(
    normalizeEntityFields('dashboard_layout', {
      ...current,
      ...fields,
    }) as DashboardLayoutFields
  )

  await applyDashboardLayoutOperation(scope, layoutId, {
    name: normalized.name,
    // A live doc can request activation but can never deactivate a layout.
    isActive: current.isActive || normalized.isActive,
    sortOrder: normalized.sortOrder,
    content: {
      layout: normalized.layout,
      colorPairs: normalized.colorPairs,
    },
  })
  return readDashboardLayoutFields(scope, layoutId)
}

type DashboardLayoutOperationInput = {
  name?: string
  isActive?: boolean
  sortOrder?: number
  content?: {
    layout: LayoutNode
    colorPairs: PersistedColorPairsState
  }
}

type DashboardLayoutMetadataPatch = {
  layoutId: string
  fields: DashboardLayoutFields
}

/**
 * Canonical dashboard layout metadata transaction: every metadata mutation
 * (name/isActive/sortOrder, plus content on the Yjs materialization path)
 * validates, reorders with a dense 0..n-1 reindex, sets/clears activation
 * across sibling rows, then refreshes the list session. Layout metadata is
 * projected back into already-open layout docs so tab edits do not force Yjs
 * document reloads.
 * `input` may be a resolver so a caller can derive its effective
 * input from the freshly-read target row (the fields path normalizes it).
 */
async function applyDashboardLayoutOperation(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  input: DashboardLayoutOperationInput | ((currentRow: LayoutRow) => DashboardLayoutOperationInput)
): Promise<void> {
  const { metadataPatches } = await withDashboardLayoutOwnerLock(scope, async (tx) => {
    const rows = await readDashboardLayoutRows(scope, tx)
    const orderedRows = sortLayoutRows(rows)
    const currentRow = rows.find((row) => row.id === layoutId)
    if (!currentRow) {
      throw new DashboardLayoutOperationError(404, 'Layout not found')
    }

    const resolved = typeof input === 'function' ? input(currentRow) : input

    const name = resolved.name === undefined ? currentRow.name : resolved.name.trim()
    if (!name) {
      throw new DashboardLayoutOperationError(400, 'Layout name is required')
    }

    const currentSortOrder = readLayoutSortOrder(currentRow)
    const sortOrder = resolved.sortOrder === undefined ? currentSortOrder : resolved.sortOrder
    const shouldReorder = sortOrder !== currentSortOrder
    if (
      shouldReorder &&
      (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder >= orderedRows.length)
    ) {
      throw new DashboardLayoutOperationError(400, 'sortOrder is out of range')
    }

    const shouldActivate = resolved.isActive === true && !currentRow.isActive
    const content = resolved.content

    const nextOrder = [...orderedRows]
    if (shouldReorder) {
      const sourceIndex = nextOrder.findIndex((row) => row.id === layoutId)
      const [moved] = nextOrder.splice(sourceIndex, 1)
      if (!moved) {
        throw new DashboardLayoutOperationError(404, 'Layout not found')
      }
      nextOrder.splice(sortOrder, 0, moved)
    }
    const now = new Date()
    await Promise.all(
      nextOrder.map((row, index) => {
        const isTarget = row.id === layoutId
        if (!isTarget && !shouldActivate && !shouldReorder) {
          return Promise.resolve()
        }

        return tx
          .update(layoutMap)
          .set({
            ...(isTarget
              ? {
                  name,
                  ...(content
                    ? {
                        layout: serializeLayout(content.layout),
                        color_pair: content.colorPairs,
                      }
                    : {}),
                }
              : {}),
            isActive: shouldActivate ? isTarget : row.isActive,
            sort_order: index,
            updatedAt: now,
          })
          .where(ownedWhere(scope, row.id))
      })
    )

    return {
      metadataPatches: nextOrder.flatMap<DashboardLayoutMetadataPatch>((row, index) => {
        const isTarget = row.id === layoutId
        const nextName = isTarget ? name : row.name
        const nextIsActive = shouldActivate ? isTarget : row.isActive
        const nextSortOrder = index
        const changed =
          nextName !== row.name ||
          nextIsActive !== row.isActive ||
          readLayoutSortOrder(row) !== nextSortOrder

        return changed
          ? [
              {
                layoutId: row.id,
                fields: {
                  ...layoutRowToFields(row),
                  name: nextName,
                  isActive: nextIsActive,
                  sortOrder: nextSortOrder,
                  ...(isTarget && content
                    ? {
                        layout: content.layout,
                        colorPairs: content.colorPairs,
                      }
                    : {}),
                },
              },
            ]
          : []
      }),
    }
  })

  await refreshLayoutList(scope)
  await Promise.all(
    metadataPatches.map((patch) =>
      applyEntityStateInSocketServer(
        patch.layoutId,
        'dashboard_layout',
        patch.fields,
        scope.ownerUserId
      )
        .then(() => undefined)
        .catch(() => undefined)
    )
  )
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

    try {
      const canDelete = await guardWorkspaceEntityDocumentDeleteInTx(tx, {
        entityKind: 'dashboard_layout',
        entityId: layoutId,
        workspaceId: scope.workspaceId,
        ownerUserId: scope.ownerUserId,
      })
      if (!canDelete) {
        throw new DashboardLayoutOperationError(404, 'Layout not found')
      }
    } catch (error) {
      if (error instanceof WorkspaceEntityDocumentDeletionError) {
        throw new DashboardLayoutOperationError(error.status, error.message)
      }
      throw error
    }

    await tx.delete(layoutMap).where(ownedWhere(scope, layoutId))
  })
  await refreshLayoutList(scope)
  await deleteYjsSessionInSocketServer(layoutId).catch(() => undefined)
}
