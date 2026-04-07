import { db } from '@tradinggoose/db'
import { customTools, mcpServers, pineIndicators, skill } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ReviewEntityKind } from './types'

/**
 * Load an entity row by kind, id, and workspaceId.
 *
 * Returns the full row so that callers can pick whichever columns they need.
 * Returns `null` when no matching row is found.
 */
export async function loadEntityByKind(
  entityKind: Exclude<ReviewEntityKind, 'workflow'>,
  entityId: string,
  workspaceId: string
) {
  switch (entityKind) {
    case 'skill':
      return loadSkill(entityId, workspaceId)
    case 'custom_tool':
      return loadCustomTool(entityId, workspaceId)
    case 'indicator':
      return loadIndicator(entityId, workspaceId)
    case 'mcp_server':
      return loadMcpServer(entityId, workspaceId)
  }
}

export async function loadSkill(entityId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, entityId), eq(skill.workspaceId, workspaceId)))
    .limit(1)

  return row ?? null
}

export async function loadCustomTool(entityId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(customTools)
    .where(and(eq(customTools.id, entityId), eq(customTools.workspaceId, workspaceId)))
    .limit(1)

  return row ?? null
}

export async function loadIndicator(entityId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(pineIndicators)
    .where(and(eq(pineIndicators.id, entityId), eq(pineIndicators.workspaceId, workspaceId)))
    .limit(1)

  return row ?? null
}

export async function loadMcpServer(entityId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.id, entityId),
        eq(mcpServers.workspaceId, workspaceId),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)

  return row ?? null
}
