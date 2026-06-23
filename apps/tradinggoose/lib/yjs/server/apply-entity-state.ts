import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { seedEntitySession } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { applyEntityStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { storeState } from '@/socket-server/yjs/persistence'

export class SavedEntityPersistenceError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'SavedEntityPersistenceError'
  }
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeSavedEntityFields(
  entityKind: SavedEntityKind,
  fields: Record<string, unknown>
): Record<string, unknown> {
  try {
    const normalized = normalizeEntityFields(entityKind, fields)
    return entityKind === 'indicator'
      ? { ...normalized, color: String(fields.color ?? '').trim() }
      : normalized
  } catch (error) {
    throw new SavedEntityPersistenceError(
      400,
      error instanceof Error ? error.message : 'Invalid saved entity fields'
    )
  }
}

async function persistSavedEntityState(
  entityKind: SavedEntityKind,
  entityId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const now = new Date()
  let persisted: Array<{ id: string }>

  switch (entityKind) {
    case 'skill':
      persisted = await db
        .update(skill)
        .set({
          name: String(fields.name ?? ''),
          description: String(fields.description ?? ''),
          content: String(fields.content ?? ''),
          updatedAt: now,
        })
        .where(eq(skill.id, entityId))
        .returning({ id: skill.id })
      break
    case 'custom_tool':
      persisted = await db
        .update(customTools)
        .set({
          title: String(fields.title ?? ''),
          schema: parseCustomToolSchemaText(fields.schemaText),
          code: String(fields.codeText ?? ''),
          updatedAt: now,
        })
        .where(eq(customTools.id, entityId))
        .returning({ id: customTools.id })
      break
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
        .where(eq(pineIndicators.id, entityId))
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
        .where(eq(knowledgeBase.id, entityId))
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
        .where(eq(mcpServers.id, entityId))
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

export async function applySavedEntityDraftState(
  entityKind: SavedEntityKind,
  entityId: string,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    await applyEntityStateInSocketServer(entityId, entityKind, fields)
  } catch {
    const doc = new Y.Doc()
    try {
      seedEntitySession(doc, { entityKind, payload: fields })
      await storeState(entityId, Y.encodeStateAsUpdate(doc))
    } finally {
      doc.destroy()
    }
  }
}

export async function applySavedEntityPersistedState(
  entityKind: SavedEntityKind,
  entityId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const normalizedFields = normalizeSavedEntityFields(entityKind, fields)
  await persistSavedEntityState(entityKind, entityId, normalizedFields)
  await applySavedEntityDraftState(entityKind, entityId, normalizedFields)
}
