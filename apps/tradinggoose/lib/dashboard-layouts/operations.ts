import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { layoutMap } from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { validateDashboardLayoutWidgetReferences } from '@/lib/copilot/tools/server/widgets/widget-reference-validation'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import {
  assertCanDeleteWorkspaceEntityDocument,
  WorkspaceEntityDocumentDeletionError,
} from '@/lib/workspaces/entity-documents'
import {
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
import { pruneDashboardColorPairsForLayout } from '@/widgets/widget-contracts'

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

async function readDashboardLayoutRows(scope: DashboardLayoutOwnerScope): Promise<LayoutRow[]> {
  return db
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
  const rows = await readDashboardLayoutRows(scope)
  const highestSortOrder = rows.reduce((max, row) => Math.max(max, readLayoutSortOrder(row)), -1)
  const layout = createDefaultLayoutState()
  const colorPairs = createDefaultColorPairsState()
  const makeActive = options?.isActive === true

  const [inserted] = await db.transaction(async (tx) => {
    if (makeActive) {
      await tx
        .update(layoutMap)
        .set({ isActive: false, updatedAt: new Date() })
        .where(ownedWhere(scope))
    }

    return tx
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
  })

  await refreshLayoutList(scope)
  return { ...toLayoutTab(inserted), layout, colorPairs }
}

export async function readActiveDashboardLayoutProjection(scope: DashboardLayoutOwnerScope) {
  const orderedRows = sortLayoutRows(await readDashboardLayoutRows(scope))
  const active = orderedRows.find((row) => row.isActive) ?? orderedRows[0]
  return {
    activeLayout: active ? await hydrateLayoutRow(active) : null,
    layouts: orderedRows.map(toLayoutTab),
  }
}

async function hydrateLayoutRow(row: LayoutRow): Promise<DashboardLayoutProjection> {
  const projection = await buildDashboardLayoutReadProjection({
    name: row.name,
    layout: row.layout as unknown as LayoutNode,
    colorPairs: row.color_pair as unknown as PersistedColorPairsState,
    isActive: row.isActive,
    sortOrder: readLayoutSortOrder(row),
  })
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
  await applyDashboardLayoutOperation(scope, layoutId, (currentRow) => {
    const current = layoutRowToFields(currentRow)
    const normalized = normalizeDashboardLayoutDocumentFields(
      normalizeEntityFields('dashboard_layout', {
        ...current,
        ...fields,
      }) as DashboardLayoutFields
    )
    return {
      name: normalized.name,
      // A live doc can request activation but can never deactivate a layout.
      isActive: current.isActive || normalized.isActive,
      sortOrder: normalized.sortOrder,
      content: {
        layout: normalized.layout,
        colorPairs: pruneDashboardColorPairsForLayout(normalized.layout, normalized.colorPairs),
      },
    }
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

/**
 * Canonical dashboard layout metadata transaction: every metadata mutation
 * (name/isActive/sortOrder, plus content on the Yjs materialization path)
 * validates, reorders with a dense 0..n-1 reindex, sets/clears activation
 * across sibling rows, then refreshes the list session. Sibling layout docs
 * whose metadata changed are discarded so subscribers rebootstrap from the
 * persisted Yjs materialization instead of receiving out-of-band patches.
 * `input` may be a resolver so a caller can derive its effective
 * input from the freshly-read target row (the fields path normalizes it).
 */
async function applyDashboardLayoutOperation(
  scope: DashboardLayoutOwnerScope,
  layoutId: string,
  input: DashboardLayoutOperationInput | ((currentRow: LayoutRow) => DashboardLayoutOperationInput)
): Promise<void> {
  const rows = await readDashboardLayoutRows(scope)
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
  if (content) {
    await validateDashboardLayoutWidgetReferences(scope, content.layout, content.colorPairs)
  }

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

  await db.transaction(async (tx) => {
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
  })

  await refreshLayoutList(scope)
  const nameChanged = name !== currentRow.name
  const staleSiblingSessionIds = new Set<string>()
  for (const [index, row] of nextOrder.entries()) {
    const changed =
      (row.id === layoutId && nameChanged) ||
      shouldActivate ||
      (shouldReorder && readLayoutSortOrder(row) !== index)
    if (changed && row.id !== layoutId) {
      staleSiblingSessionIds.add(row.id)
    }
  }

  await Promise.all(
    [...staleSiblingSessionIds].map((sessionId) =>
      deleteYjsSessionInSocketServer(sessionId).catch(() => undefined)
    )
  )
}

export async function deleteDashboardLayout(scope: DashboardLayoutOwnerScope, layoutId: string) {
  const row = await readOwnedLayoutRow(scope, layoutId)
  if (row.isActive) {
    throw new DashboardLayoutOperationError(400, 'Cannot delete active layout')
  }

  try {
    await assertCanDeleteWorkspaceEntityDocument({
      entityKind: 'dashboard_layout',
      workspaceId: scope.workspaceId,
      ownerUserId: scope.ownerUserId,
    })
  } catch (error) {
    if (error instanceof WorkspaceEntityDocumentDeletionError) {
      throw new DashboardLayoutOperationError(error.status, error.message)
    }
    throw error
  }

  await db.delete(layoutMap).where(ownedWhere(scope, layoutId))
  await refreshLayoutList(scope)
  await deleteYjsSessionInSocketServer(layoutId).catch(() => undefined)
}
