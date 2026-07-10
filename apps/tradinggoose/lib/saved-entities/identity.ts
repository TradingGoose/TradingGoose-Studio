import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  layoutMaps,
  mcpServers,
  pineIndicators,
  skill,
  watchlistTable,
  workflow,
} from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

export type SavedEntityIdentityInput = {
  entityKind: ReviewEntityKind
  entityId: string
  workspaceId: string
  ownerUserId?: string | null
  name: string
}

export class SavedEntityIdentityError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'SavedEntityIdentityError'
  }
}

const isUniqueConstraintViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505'

export function normalizeSavedEntityIdentity(entityKind: ReviewEntityKind, value: string): string {
  const name = entityKind === 'custom_tool' ? value.trim().replace(/\s+/g, ' ') : value.trim()
  if (!name) throw new SavedEntityIdentityError(400, 'name is required')
  return name
}

export async function renameSavedEntityIdentity(input: SavedEntityIdentityInput): Promise<string> {
  const { entityKind, entityId, workspaceId } = input
  const ownerUserId = input.ownerUserId?.trim() || null
  const name = normalizeSavedEntityIdentity(entityKind, input.name)
  const updatedAt = new Date()

  try {
    let rows: Array<{ id: string }>
    switch (entityKind) {
      case 'workflow':
        rows = await db
          .update(workflow)
          .set({ name, updatedAt })
          .where(and(eq(workflow.id, entityId), eq(workflow.workspaceId, workspaceId)))
          .returning({ id: workflow.id })
        break
      case 'skill':
        rows = await db
          .update(skill)
          .set({ name, updatedAt })
          .where(and(eq(skill.id, entityId), eq(skill.workspaceId, workspaceId)))
          .returning({ id: skill.id })
        break
      case 'custom_tool':
        rows = await db
          .update(customTools)
          .set({ title: name, updatedAt })
          .where(and(eq(customTools.id, entityId), eq(customTools.workspaceId, workspaceId)))
          .returning({ id: customTools.id })
        break
      case 'indicator':
        rows = await db
          .update(pineIndicators)
          .set({ name, updatedAt })
          .where(and(eq(pineIndicators.id, entityId), eq(pineIndicators.workspaceId, workspaceId)))
          .returning({ id: pineIndicators.id })
        break
      case 'knowledge_base':
        rows = await db
          .update(knowledgeBase)
          .set({ name, updatedAt })
          .where(
            and(
              eq(knowledgeBase.id, entityId),
              eq(knowledgeBase.workspaceId, workspaceId),
              isNull(knowledgeBase.deletedAt)
            )
          )
          .returning({ id: knowledgeBase.id })
        break
      case 'mcp_server':
        rows = await db
          .update(mcpServers)
          .set({ name, updatedAt })
          .where(
            and(
              eq(mcpServers.id, entityId),
              eq(mcpServers.workspaceId, workspaceId),
              isNull(mcpServers.deletedAt)
            )
          )
          .returning({ id: mcpServers.id })
        break
      case 'watchlist':
        rows = await db
          .update(watchlistTable)
          .set({ name, updatedAt })
          .where(
            and(
              eq(watchlistTable.id, entityId),
              eq(watchlistTable.workspaceId, workspaceId),
              isNull(watchlistTable.userId),
              isNull(watchlistTable.parentId)
            )
          )
          .returning({ id: watchlistTable.id })
        break
      case 'dashboard_layout':
        if (!ownerUserId) {
          throw new SavedEntityIdentityError(400, 'Dashboard layout ownerUserId is required')
        }
        rows = await db
          .update(layoutMaps)
          .set({ name, updatedAt })
          .where(
            and(
              eq(layoutMaps.id, entityId),
              eq(layoutMaps.workspaceId, workspaceId),
              eq(layoutMaps.userId, ownerUserId)
            )
          )
          .returning({ id: layoutMaps.id })
        break
    }

    if (rows.length === 0) {
      throw new SavedEntityIdentityError(
        404,
        `Saved ${entityKind} ${entityId} was not found while renaming`
      )
    }
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new SavedEntityIdentityError(409, `An entity named "${name}" already exists`)
    }
    throw error
  }

  await refreshEntityListSession(entityKind, workspaceId, ownerUserId)
  return name
}
