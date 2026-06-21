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
import { seedEntitySession } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { applyEntityStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { storeCanonicalState } from '@/socket-server/yjs/persistence'

function parseObjectJson(value: unknown, fieldName: string): Record<string, unknown> {
  const parsed = JSON.parse(String(value ?? ''))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
          schema: parseObjectJson(fields.schemaText, 'schemaText'),
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
    throw new Error(`Saved ${entityKind} ${entityId} was not found while materializing Yjs state`)
  }
}

export async function applySavedEntityState(
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
      await storeCanonicalState(entityId, Y.encodeStateAsUpdate(doc))
    } finally {
      doc.destroy()
    }
  }

  await persistSavedEntityState(entityKind, entityId, fields)
}
