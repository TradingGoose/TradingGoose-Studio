import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import {
  customTools,
  layoutMap,
  mcpServers,
  pineIndicators,
  skill,
  watchlistTable,
  workflow,
} from '@tradinggoose/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { validateDashboardLayoutWidgetReferences } from '@/lib/copilot/tools/server/widgets/widget-reference-validation'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import {
  assertCanDeleteWorkspaceEntityDocument,
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
import {
  dashboardLayoutNeedsDefaultReferenceParams,
  type DashboardLayoutDefaultReferenceParams,
  initializeDashboardLayoutLinkedParams,
  normalizeDashboardLayoutDocumentFields,
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

export async function readDefaultDashboardLayoutReferenceParams(
  workspaceId: string
): Promise<DashboardLayoutDefaultReferenceParams> {
  const [workflowRow, watchlistRow, indicatorRow, mcpServerRow, customToolRow, skillRow] =
    await Promise.all([
      db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))
        .orderBy(asc(workflow.name), asc(workflow.id))
        .limit(1),
      db
        .select({ id: watchlistTable.id })
        .from(watchlistTable)
        .where(
          and(
            eq(watchlistTable.workspaceId, workspaceId),
            isNull(watchlistTable.userId),
            isNull(watchlistTable.parentId)
          )
        )
        .orderBy(asc(watchlistTable.sortOrder), asc(watchlistTable.name), asc(watchlistTable.id))
        .limit(1),
      db
        .select({ id: pineIndicators.id })
        .from(pineIndicators)
        .where(eq(pineIndicators.workspaceId, workspaceId))
        .orderBy(asc(pineIndicators.name), asc(pineIndicators.id))
        .limit(1),
      db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
        .orderBy(asc(mcpServers.name), asc(mcpServers.id))
        .limit(1),
      db
        .select({ id: customTools.id })
        .from(customTools)
        .where(eq(customTools.workspaceId, workspaceId))
        .orderBy(asc(customTools.title), asc(customTools.id))
        .limit(1),
      db
        .select({ id: skill.id })
        .from(skill)
        .where(eq(skill.workspaceId, workspaceId))
        .orderBy(asc(skill.name), asc(skill.id))
        .limit(1),
    ])

  return {
    ...(workflowRow[0]?.id ? { workflowId: workflowRow[0].id } : {}),
    ...(watchlistRow[0]?.id ? { watchlistId: String(watchlistRow[0].id) } : {}),
    ...(indicatorRow[0]?.id ? { indicatorId: String(indicatorRow[0].id) } : {}),
    ...(mcpServerRow[0]?.id ? { mcpServerId: mcpServerRow[0].id } : {}),
    ...(customToolRow[0]?.id ? { customToolId: customToolRow[0].id } : {}),
    ...(skillRow[0]?.id ? { skillId: skillRow[0].id } : {}),
  }
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
  const fields = layoutRowToFields(row)
  const defaultReferences = dashboardLayoutNeedsDefaultReferenceParams(fields.layout)
    ? await readDefaultDashboardLayoutReferenceParams(row.workspaceId)
    : {}
  const initialized = initializeDashboardLayoutLinkedParams(fields, defaultReferences)
  const projection = await buildDashboardLayoutReadProjection(initialized)
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
  const defaultReferences = dashboardLayoutNeedsDefaultReferenceParams(normalized.layout)
    ? await readDefaultDashboardLayoutReferenceParams(scope.workspaceId)
    : {}
  const initialized = initializeDashboardLayoutLinkedParams(normalized, defaultReferences)

  await applyDashboardLayoutOperation(scope, layoutId, {
    name: initialized.name,
    // A live doc can request activation but can never deactivate a layout.
    isActive: current.isActive || initialized.isActive,
    sortOrder: initialized.sortOrder,
    content: {
      layout: initialized.layout,
      colorPairs: initialized.colorPairs,
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
  const metadataPatches: Array<Promise<void>> = []
  for (const [index, row] of nextOrder.entries()) {
    const isTarget = row.id === layoutId
    const nextName = isTarget ? name : row.name
    const nextIsActive = shouldActivate ? isTarget : row.isActive
    const nextSortOrder = index
    const changed =
      nextName !== row.name ||
      nextIsActive !== row.isActive ||
      readLayoutSortOrder(row) !== nextSortOrder

    if (changed) {
      metadataPatches.push(
        applyEntityStateInSocketServer(
          row.id,
          'dashboard_layout',
          {
            ...layoutRowToFields(row),
            name: nextName,
            isActive: nextIsActive,
            sortOrder: nextSortOrder,
          },
          scope.ownerUserId
        )
          .then(() => undefined)
          .catch(() => undefined)
      )
    }
  }

  await Promise.all(metadataPatches)
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
