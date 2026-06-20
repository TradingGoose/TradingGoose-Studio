import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'

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
