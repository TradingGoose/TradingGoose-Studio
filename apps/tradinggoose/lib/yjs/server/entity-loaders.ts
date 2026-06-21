import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { type SavedEntityKind, savedEntityRowToFields } from '@/lib/yjs/entity-state'

export async function resolveEntityWorkspaceId(
  entityKind: SavedEntityKind,
  entityId: string
): Promise<string | null> {
  switch (entityKind) {
    case 'skill': {
      const [row] = await db
        .select({ workspaceId: skill.workspaceId })
        .from(skill)
        .where(eq(skill.id, entityId))
        .limit(1)
      return row?.workspaceId ?? null
    }
    case 'custom_tool': {
      const [row] = await db
        .select({ workspaceId: customTools.workspaceId })
        .from(customTools)
        .where(eq(customTools.id, entityId))
        .limit(1)
      return row?.workspaceId ?? null
    }
    case 'indicator': {
      const [row] = await db
        .select({ workspaceId: pineIndicators.workspaceId })
        .from(pineIndicators)
        .where(eq(pineIndicators.id, entityId))
        .limit(1)
      return row?.workspaceId ?? null
    }
    case 'knowledge_base': {
      const [row] = await db
        .select({ workspaceId: knowledgeBase.workspaceId })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, entityId), isNull(knowledgeBase.deletedAt)))
        .limit(1)
      return row?.workspaceId ?? null
    }
    case 'mcp_server': {
      const [row] = await db
        .select({ workspaceId: mcpServers.workspaceId })
        .from(mcpServers)
        .where(and(eq(mcpServers.id, entityId), isNull(mcpServers.deletedAt)))
        .limit(1)
      return row?.workspaceId ?? null
    }
  }
}

export async function readSavedEntityFieldsFromDb(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  let row: Parameters<typeof savedEntityRowToFields>[1] | undefined

  switch (entityKind) {
    case 'skill':
      ;[row] = await db
        .select()
        .from(skill)
        .where(and(eq(skill.id, entityId), eq(skill.workspaceId, workspaceId)))
        .limit(1)
      break
    case 'custom_tool':
      ;[row] = await db
        .select()
        .from(customTools)
        .where(and(eq(customTools.id, entityId), eq(customTools.workspaceId, workspaceId)))
        .limit(1)
      break
    case 'indicator':
      ;[row] = await db
        .select()
        .from(pineIndicators)
        .where(and(eq(pineIndicators.id, entityId), eq(pineIndicators.workspaceId, workspaceId)))
        .limit(1)
      break
    case 'knowledge_base':
      ;[row] = await db
        .select()
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.id, entityId),
            eq(knowledgeBase.workspaceId, workspaceId),
            isNull(knowledgeBase.deletedAt)
          )
        )
        .limit(1)
      break
    case 'mcp_server':
      ;[row] = await db
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
      break
  }

  if (!row) {
    throw new Error(`Saved ${entityKind} ${entityId} was not found`)
  }

  return savedEntityRowToFields(entityKind, row)
}
