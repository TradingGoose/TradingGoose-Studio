import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type * as Y from 'yjs'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { getEntityFields, getEntityWorkspaceId, seedEntitySession } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import {
  applyEntityStateInSocketServer,
  notifyEntityListMembersUpserted,
} from '@/lib/yjs/server/snapshot-bridge'

export class SavedEntityPersistenceError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'SavedEntityPersistenceError'
  }

  responseBody() {
    return { error: this.message, ...(this.code ? { code: this.code } : {}) }
  }
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

async function mapUniqueConstraint<T>(operation: Promise<T>, message: string): Promise<T> {
  try {
    return await operation
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new SavedEntityPersistenceError(409, message)
    }
    throw error
  }
}

function normalizeSavedEntityFields(
  entityKind: SavedEntityKind,
  fields: Record<string, unknown>
): Record<string, unknown> {
  try {
    return normalizeEntityFields(entityKind, fields)
  } catch (error) {
    throw new SavedEntityPersistenceError(
      400,
      error instanceof Error ? error.message : 'Invalid saved entity fields'
    )
  }
}

export async function publishCreatedSavedEntityListMembers(
  entityKind: SavedEntityKind,
  workspaceId: string,
  members: Array<{ id: string; name: string; enabled?: boolean }>,
  afterRollback?: () => Promise<unknown>
): Promise<void> {
  try {
    await notifyEntityListMembersUpserted(entityKind, workspaceId, members)
  } catch (error) {
    const ids = members.map((member) => member.id)
    if (entityKind === 'skill') await db.delete(skill).where(inArray(skill.id, ids))
    if (entityKind === 'custom_tool')
      await db.delete(customTools).where(inArray(customTools.id, ids))
    if (entityKind === 'indicator')
      await db.delete(pineIndicators).where(inArray(pineIndicators.id, ids))
    if (entityKind === 'knowledge_base')
      await db.delete(knowledgeBase).where(inArray(knowledgeBase.id, ids))
    if (entityKind === 'mcp_server') await db.delete(mcpServers).where(inArray(mcpServers.id, ids))
    await afterRollback?.()
    throw error
  }
}

async function persistSavedEntityState(
  entityKind: SavedEntityKind,
  entityId: string,
  fields: Record<string, unknown>,
  workspaceId: string
): Promise<void> {
  const now = new Date()
  let persisted: Array<{ id: string }>

  switch (entityKind) {
    case 'skill': {
      const name = String(fields.name ?? '')
      persisted = await mapUniqueConstraint(
        db
          .update(skill)
          .set({
            name,
            description: String(fields.description ?? ''),
            content: String(fields.content ?? ''),
            updatedAt: now,
          })
          .where(and(eq(skill.id, entityId), eq(skill.workspaceId, workspaceId)))
          .returning({ id: skill.id }),
        `A skill with the name "${name}" already exists in this workspace`
      )
      break
    }
    case 'custom_tool': {
      const title = String(fields.title ?? '')
      persisted = await mapUniqueConstraint(
        db
          .update(customTools)
          .set({
            title,
            schema: parseCustomToolSchemaText(fields.schemaText),
            code: String(fields.codeText ?? ''),
            updatedAt: now,
          })
          .where(and(eq(customTools.id, entityId), eq(customTools.workspaceId, workspaceId)))
          .returning({ id: customTools.id }),
        `A tool with the title "${title}" already exists in this workspace`
      )
      break
    }
    case 'indicator':
      persisted = await db
        .update(pineIndicators)
        .set({
          name: String(fields.name ?? ''),
          color: String(fields.color ?? ''),
          pineCode: String(fields.pineCode ?? ''),
          inputMeta: objectField(fields.inputMeta),
          updatedAt: now,
        })
        .where(and(eq(pineIndicators.id, entityId), eq(pineIndicators.workspaceId, workspaceId)))
        .returning({ id: pineIndicators.id })
      break
    case 'knowledge_base':
      persisted = await db
        .update(knowledgeBase)
        .set({
          name: String(fields.name ?? ''),
          description: String(fields.description ?? ''),
          chunkingConfig: fields.chunkingConfig,
          updatedAt: now,
        })
        .where(and(eq(knowledgeBase.id, entityId), eq(knowledgeBase.workspaceId, workspaceId)))
        .returning({ id: knowledgeBase.id })
      break
    case 'mcp_server':
      persisted = await db
        .update(mcpServers)
        .set({
          name: String(fields.name ?? ''),
          description: String(fields.description ?? '') || null,
          transport: String(fields.transport ?? 'http'),
          url: String(fields.url ?? '') || null,
          headers: objectField(fields.headers),
          command: String(fields.command ?? '') || null,
          args: Array.isArray(fields.args) ? fields.args.map(String) : [],
          env: objectField(fields.env),
          timeout: Number(fields.timeout ?? 30000),
          retries: Number(fields.retries ?? 3),
          enabled: fields.enabled !== false,
          updatedAt: now,
        })
        .where(and(eq(mcpServers.id, entityId), eq(mcpServers.workspaceId, workspaceId)))
        .returning({ id: mcpServers.id })
      break
  }

  if (persisted.length === 0) {
    throw new SavedEntityPersistenceError(
      404,
      `Saved ${entityKind} ${entityId} was not found while materializing Yjs state`
    )
  }
}

export async function applySavedEntityState(
  entityKind: SavedEntityKind,
  entityId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const normalizedFields = normalizeSavedEntityFields(entityKind, fields)
  try {
    await applyEntityStateInSocketServer(entityId, entityKind, normalizedFields)
  } catch (error) {
    const status = Number((error as { status?: unknown }).status)
    if (status === 400 || status === 404 || status === 409) {
      throw new SavedEntityPersistenceError(
        status,
        error instanceof Error ? error.message : 'Saved entity persistence failed'
      )
    }
    throw new SavedEntityPersistenceError(
      503,
      'Saved entity realtime orchestration is required',
      'SAVED_ENTITY_REALTIME_REQUIRED'
    )
  }
}

export async function saveSavedEntityYjsDocToDb(
  entityKind: SavedEntityKind,
  entityId: string,
  doc: Y.Doc
): Promise<void> {
  const yjsFields = normalizeSavedEntityFields(entityKind, getEntityFields(doc, entityKind))
  const workspaceId = getEntityWorkspaceId(doc)
  if (!workspaceId) {
    throw new SavedEntityPersistenceError(
      404,
      `Saved ${entityKind} ${entityId} workspace is missing while materializing Yjs state`
    )
  }
  await persistSavedEntityState(entityKind, entityId, yjsFields, workspaceId)
  seedEntitySession(doc, { entityKind, payload: yjsFields })
}
