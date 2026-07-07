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
import { and, eq, isNull } from 'drizzle-orm'

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

type AssertCanDeleteWorkspaceEntityDocumentParams = {
  entityKind: WorkspaceEntityDocumentKind
  workspaceId: string
  ownerUserId?: string | null
}

export async function assertCanDeleteWorkspaceEntityDocument({
  entityKind,
  workspaceId,
  ownerUserId,
}: AssertCanDeleteWorkspaceEntityDocumentParams) {
  let rows: Array<{ id: unknown }>
  switch (entityKind) {
    case 'workflow':
      rows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))
        .limit(2)
      break
    case 'skill':
      rows = await db
        .select({ id: skill.id })
        .from(skill)
        .where(eq(skill.workspaceId, workspaceId))
        .limit(2)
      break
    case 'custom_tool':
      rows = await db
        .select({ id: customTools.id })
        .from(customTools)
        .where(eq(customTools.workspaceId, workspaceId))
        .limit(2)
      break
    case 'indicator':
      rows = await db
        .select({ id: pineIndicators.id })
        .from(pineIndicators)
        .where(eq(pineIndicators.workspaceId, workspaceId))
        .limit(2)
      break
    case 'mcp_server':
      rows = await db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
        .limit(2)
      break
    case 'dashboard_layout': {
      if (!ownerUserId) {
        throw new Error('Dashboard layout ownerUserId is required')
      }
      rows = await db
        .select({ id: layoutMap.id })
        .from(layoutMap)
        .where(and(eq(layoutMap.workspaceId, workspaceId), eq(layoutMap.userId, ownerUserId)))
        .limit(2)
      break
    }
    case 'watchlist':
      rows = await db
        .select({ id: watchlistTable.id })
        .from(watchlistTable)
        .where(
          and(
            eq(watchlistTable.workspaceId, workspaceId),
            isNull(watchlistTable.userId),
            isNull(watchlistTable.parentId)
          )
        )
        .limit(2)
      break
  }

  if (rows.length <= 1) {
    throw new WorkspaceEntityDocumentDeletionError(entityKind)
  }
}
