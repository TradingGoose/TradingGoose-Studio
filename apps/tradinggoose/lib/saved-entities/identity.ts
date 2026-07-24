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
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import {
  listDashboardLayouts,
  nextDashboardLayoutRevision,
  withDashboardLayoutOwnerLock,
} from '@/lib/dashboard-layouts/operations'
import { lockSavedEntityList } from '@/lib/yjs/server/entity-loaders'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

export type SavedEntityIdentityMutation = {
  name: string
}

export type SavedEntityIdentityInput = SavedEntityIdentityMutation & {
  entityKind: ReviewEntityKind
  entityId: string
  workspaceId: string
  ownerUserId?: string | null
  expectedCurrentName?: string
}

type SavedEntityIdentityWriter = Pick<typeof db, 'update'>

export class SavedEntityIdentityError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'SavedEntityIdentityError'
  }
}

const SAVED_ENTITY_NAME_CONSTRAINTS: Partial<Record<ReviewEntityKind, string>> = {
  skill: 'skill_workspace_name_unique',
  custom_tool: 'custom_tools_workspace_title_unique',
  watchlist: 'watchlist_table_workspace_user_name_unique',
}

function isSavedEntityNameConflict(error: unknown, entityKind: ReviewEntityKind): boolean {
  const expectedConstraint = SAVED_ENTITY_NAME_CONSTRAINTS[entityKind]
  const seen = new Set<object>()
  let current = error

  while (expectedConstraint && typeof current === 'object' && current && !seen.has(current)) {
    seen.add(current)
    const record = current as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    if (record.code === '23505' && record.constraint_name === expectedConstraint) return true
    current = record.cause
  }

  return false
}

export function normalizeSavedEntityIdentity(entityKind: ReviewEntityKind, value: string): string {
  const name = entityKind === 'custom_tool' ? value.trim().replace(/\s+/g, ' ') : value.trim()
  if (!name) throw new SavedEntityIdentityError(400, 'name is required')
  return name
}

export async function renameSavedEntityIdentityInTx(
  writer: SavedEntityIdentityWriter,
  input: SavedEntityIdentityInput,
  updatedAt = new Date()
): Promise<{ name: string; updatedAt: Date }> {
  const { entityKind, entityId, workspaceId } = input
  const ownerUserId = input.ownerUserId?.trim() || null
  const name = normalizeSavedEntityIdentity(entityKind, input.name)
  const expectedCurrentName =
    input.expectedCurrentName === undefined
      ? undefined
      : normalizeSavedEntityIdentity(entityKind, input.expectedCurrentName)
  const expectedNameWhere = (column: AnyPgColumn) =>
    expectedCurrentName === undefined ? undefined : eq(column, expectedCurrentName)
  let rows: Array<{ id: string; updatedAt: Date }> = []

  try {
    switch (entityKind) {
      case 'workflow':
        rows = await writer
          .update(workflow)
          .set({ name, updatedAt })
          .where(
            and(
              eq(workflow.id, entityId),
              eq(workflow.workspaceId, workspaceId),
              expectedNameWhere(workflow.name)
            )
          )
          .returning({ id: workflow.id, updatedAt: workflow.updatedAt })
        break
      case 'skill':
        rows = await writer
          .update(skill)
          .set({ name, updatedAt })
          .where(
            and(
              eq(skill.id, entityId),
              eq(skill.workspaceId, workspaceId),
              expectedNameWhere(skill.name)
            )
          )
          .returning({ id: skill.id, updatedAt: skill.updatedAt })
        break
      case 'custom_tool':
        rows = await writer
          .update(customTools)
          .set({ title: name, updatedAt })
          .where(
            and(
              eq(customTools.id, entityId),
              eq(customTools.workspaceId, workspaceId),
              expectedNameWhere(customTools.title)
            )
          )
          .returning({ id: customTools.id, updatedAt: customTools.updatedAt })
        break
      case 'indicator':
        rows = await writer
          .update(pineIndicators)
          .set({ name, updatedAt })
          .where(
            and(
              eq(pineIndicators.id, entityId),
              eq(pineIndicators.workspaceId, workspaceId),
              expectedNameWhere(pineIndicators.name)
            )
          )
          .returning({ id: pineIndicators.id, updatedAt: pineIndicators.updatedAt })
        break
      case 'knowledge_base':
        rows = await writer
          .update(knowledgeBase)
          .set({ name, updatedAt })
          .where(
            and(
              eq(knowledgeBase.id, entityId),
              eq(knowledgeBase.workspaceId, workspaceId),
              isNull(knowledgeBase.deletedAt),
              expectedNameWhere(knowledgeBase.name)
            )
          )
          .returning({ id: knowledgeBase.id, updatedAt: knowledgeBase.updatedAt })
        break
      case 'mcp_server':
        rows = await writer
          .update(mcpServers)
          .set({ name, updatedAt })
          .where(
            and(
              eq(mcpServers.id, entityId),
              eq(mcpServers.workspaceId, workspaceId),
              isNull(mcpServers.deletedAt),
              expectedNameWhere(mcpServers.name)
            )
          )
          .returning({ id: mcpServers.id, updatedAt: mcpServers.updatedAt })
        break
      case 'watchlist':
        rows = await writer
          .update(watchlistTable)
          .set({ name, updatedAt })
          .where(
            and(
              eq(watchlistTable.id, entityId),
              eq(watchlistTable.workspaceId, workspaceId),
              isNull(watchlistTable.userId),
              isNull(watchlistTable.parentId),
              expectedNameWhere(watchlistTable.name)
            )
          )
          .returning({ id: watchlistTable.id, updatedAt: watchlistTable.updatedAt })
        break
      case 'dashboard_layout':
        if (!ownerUserId) {
          throw new SavedEntityIdentityError(400, 'Dashboard layout ownerUserId is required')
        }
        rows = await writer
          .update(layoutMaps)
          .set({ name, updatedAt })
          .where(
            and(
              eq(layoutMaps.id, entityId),
              eq(layoutMaps.workspaceId, workspaceId),
              eq(layoutMaps.userId, ownerUserId),
              expectedNameWhere(layoutMaps.name)
            )
          )
          .returning({ id: layoutMaps.id, updatedAt: layoutMaps.updatedAt })
        break
    }

    if (rows.length === 0) {
      if (expectedCurrentName !== undefined) {
        throw new SavedEntityIdentityError(
          409,
          'This reviewed Copilot rename is stale because the target changed after review.',
          'stale_server_tool_review'
        )
      }
      throw new SavedEntityIdentityError(
        404,
        `Saved ${entityKind} ${entityId} was not found while renaming`
      )
    }
  } catch (error) {
    if (isSavedEntityNameConflict(error, entityKind)) {
      throw new SavedEntityIdentityError(
        409,
        `An entity named "${name}" already exists`,
        'saved_entity_name_conflict'
      )
    }
    throw error
  }

  return { name, updatedAt: rows[0].updatedAt }
}

export async function renameSavedEntityIdentity(
  input: SavedEntityIdentityInput
): Promise<{ name: string; updatedAt: Date }> {
  let identity: { name: string; updatedAt: Date }
  if (input.entityKind === 'dashboard_layout') {
    const ownerUserId = input.ownerUserId?.trim()
    if (!ownerUserId) {
      throw new SavedEntityIdentityError(400, 'Dashboard layout ownerUserId is required')
    }
    const scope = { workspaceId: input.workspaceId, ownerUserId }
    identity = await withDashboardLayoutOwnerLock(scope, async (tx) =>
      renameSavedEntityIdentityInTx(
        tx,
        input,
        nextDashboardLayoutRevision(await listDashboardLayouts(scope, tx))
      )
    )
  } else {
    const entityKind = input.entityKind
    identity = await db.transaction(async (tx) => {
      await lockSavedEntityList(tx, entityKind, input.workspaceId)
      return renameSavedEntityIdentityInTx(tx, input)
    })
  }
  await refreshEntityListSession(
    input.entityKind,
    input.workspaceId,
    input.ownerUserId?.trim() || null
  )
  return identity
}
