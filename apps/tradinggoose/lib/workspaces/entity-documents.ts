import {
  customTools,
  layoutMap,
  mcpServers,
  pineIndicators,
  skill,
  watchlistTable,
  workflow,
} from '@tradinggoose/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

export type WorkspaceEntityDocumentKind =
  | 'workflow'
  | 'skill'
  | 'custom_tool'
  | 'indicator'
  | 'mcp_server'
  | 'dashboard_layout'
  | 'watchlist'

export class WorkspaceEntityDocumentDeletionError extends Error {
  readonly status = 400

  constructor(entityKind: WorkspaceEntityDocumentKind) {
    const label = entityKind.replaceAll('_', ' ').replace('mcp', 'MCP')
    super(`Cannot delete the last ${label} in this workspace`)
    this.name = 'WorkspaceEntityDocumentDeletionError'
  }
}

const WORKSPACE_ENTITY_DOCUMENT_DELETE_LOCK_NAMESPACE = 1_904_202_617

type WorkspaceEntityDocumentDeleteStore = {
  execute(query: unknown): unknown
  select: (...args: any[]) => any
}

type GuardWorkspaceEntityDocumentDeleteParams = {
  entityKind: WorkspaceEntityDocumentKind
  entityId: string
  workspaceId: string
  ownerUserId?: string | null
}

export async function guardWorkspaceEntityDocumentDeleteInTx(
  tx: WorkspaceEntityDocumentDeleteStore,
  { entityKind, entityId, workspaceId, ownerUserId }: GuardWorkspaceEntityDocumentDeleteParams
): Promise<boolean> {
  let table: { id: unknown }
  let targetWhere: unknown
  let scopeWhere: unknown
  let lockScope = `${entityKind}:${workspaceId}`
  switch (entityKind) {
    case 'workflow':
      table = workflow
      targetWhere = and(eq(workflow.id, entityId), eq(workflow.workspaceId, workspaceId))
      scopeWhere = eq(workflow.workspaceId, workspaceId)
      break
    case 'skill':
      table = skill
      targetWhere = and(eq(skill.id, entityId), eq(skill.workspaceId, workspaceId))
      scopeWhere = eq(skill.workspaceId, workspaceId)
      break
    case 'custom_tool':
      table = customTools
      targetWhere = and(eq(customTools.id, entityId), eq(customTools.workspaceId, workspaceId))
      scopeWhere = eq(customTools.workspaceId, workspaceId)
      break
    case 'indicator':
      table = pineIndicators
      targetWhere = and(
        eq(pineIndicators.id, entityId),
        eq(pineIndicators.workspaceId, workspaceId)
      )
      scopeWhere = eq(pineIndicators.workspaceId, workspaceId)
      break
    case 'mcp_server':
      table = mcpServers
      targetWhere = and(
        eq(mcpServers.id, entityId),
        eq(mcpServers.workspaceId, workspaceId),
        isNull(mcpServers.deletedAt)
      )
      scopeWhere = and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt))
      break
    case 'dashboard_layout': {
      if (!ownerUserId) {
        throw new Error('Dashboard layout ownerUserId is required')
      }
      lockScope = `${entityKind}:${workspaceId}:${ownerUserId}`
      table = layoutMap
      targetWhere = and(
        eq(layoutMap.id, entityId),
        eq(layoutMap.workspaceId, workspaceId),
        eq(layoutMap.userId, ownerUserId)
      )
      scopeWhere = and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, ownerUserId))
      break
    }
    case 'watchlist':
      table = watchlistTable
      targetWhere = and(
        eq(watchlistTable.id, entityId),
        eq(watchlistTable.workspaceId, workspaceId),
        isNull(watchlistTable.userId),
        isNull(watchlistTable.parentId)
      )
      scopeWhere = and(
        eq(watchlistTable.workspaceId, workspaceId),
        isNull(watchlistTable.userId),
        isNull(watchlistTable.parentId)
      )
      break
  }

  await tx.execute(
    sql`select pg_advisory_xact_lock(${WORKSPACE_ENTITY_DOCUMENT_DELETE_LOCK_NAMESPACE}, hashtext(${lockScope}))`
  )

  const targetRows = (await tx
    .select({ id: table.id })
    .from(table)
    .where(targetWhere)
    .limit(1)) as Array<{ id: unknown }>
  if (targetRows.length === 0) {
    return false
  }
  const rows = (await tx.select({ id: table.id }).from(table).where(scopeWhere).limit(2)) as Array<{
    id: unknown
  }>
  if (rows.length <= 1) {
    throw new WorkspaceEntityDocumentDeletionError(entityKind)
  }
  return true
}
