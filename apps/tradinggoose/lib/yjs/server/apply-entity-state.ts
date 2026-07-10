import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type * as Y from 'yjs'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import {
  DashboardLayoutOperationError,
  persistDashboardLayoutDirtyChannels,
} from '@/lib/dashboard-layouts/operations'
import { materializeWatchlistDocumentInTx } from '@/lib/watchlists/document'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import {
  beginDashboardLayoutDirtyFlush,
  completeDashboardLayoutDirtyFlush,
  failDashboardLayoutDirtyFlush,
  readDashboardLayoutContent,
} from '@/lib/yjs/dashboard-layout-session'
import {
  getEntityFields,
  getEntityOwnerUserId,
  getEntityWorkspaceId,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import type { SavedEntityApplyOptions, SavedEntityKind } from '@/lib/yjs/entity-state'
import { applyEntityStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'

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

async function persistSavedEntityState(
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  entityId: string,
  fields: Record<string, unknown>,
  workspaceId: string,
  options?: SavedEntityApplyOptions
): Promise<Record<string, unknown>> {
  const now = new Date()
  let persisted: Array<{ id: string }>

  switch (entityKind) {
    case 'skill': {
      persisted = await db
        .update(skill)
        .set({
          description: String(fields.description ?? ''),
          content: String(fields.content ?? ''),
          updatedAt: now,
        })
        .where(and(eq(skill.id, entityId), eq(skill.workspaceId, workspaceId)))
        .returning({ id: skill.id })
      break
    }
    case 'custom_tool': {
      persisted = await db
        .update(customTools)
        .set({
          schema: parseCustomToolSchemaText(fields.schemaText),
          code: String(fields.codeText ?? ''),
          updatedAt: now,
        })
        .where(and(eq(customTools.id, entityId), eq(customTools.workspaceId, workspaceId)))
        .returning({ id: customTools.id })
      break
    }
    case 'indicator':
      persisted = await db
        .update(pineIndicators)
        .set({
          color: String(fields.color ?? ''),
          pineCode: String(fields.pineCode ?? ''),
          updatedAt: now,
        })
        .where(and(eq(pineIndicators.id, entityId), eq(pineIndicators.workspaceId, workspaceId)))
        .returning({ id: pineIndicators.id })
      break
    case 'knowledge_base':
      persisted = await db
        .update(knowledgeBase)
        .set({
          description: String(fields.description ?? ''),
          chunkingConfig: fields.chunkingConfig,
          updatedAt: now,
        })
        .where(and(eq(knowledgeBase.id, entityId), eq(knowledgeBase.workspaceId, workspaceId)))
        .returning({ id: knowledgeBase.id })
      break
    case 'mcp_server': {
      const url = String(fields.url ?? '') || null
      const enabled = fields.enabled !== false
      const disconnectedState =
        !enabled || !url
          ? {
              connectionStatus: 'disconnected' as const,
              lastError: null,
              lastToolsRefresh: null,
              toolCount: 0,
            }
          : {}
      persisted = await db
        .update(mcpServers)
        .set({
          description: String(fields.description ?? '') || null,
          transport: String(fields.transport ?? 'http'),
          url,
          headers: objectField(fields.headers),
          command: String(fields.command ?? '') || null,
          args: Array.isArray(fields.args) ? fields.args.map(String) : [],
          env: objectField(fields.env),
          timeout: Number(fields.timeout ?? 30000),
          retries: Number(fields.retries ?? 3),
          enabled,
          updatedAt: now,
          ...disconnectedState,
        })
        .where(and(eq(mcpServers.id, entityId), eq(mcpServers.workspaceId, workspaceId)))
        .returning({ id: mcpServers.id })
      break
    }
    case 'watchlist':
      try {
        return await db.transaction((tx) =>
          materializeWatchlistDocumentInTx(
            tx,
            workspaceId,
            entityId,
            fields,
            options?.entityName === undefined ? undefined : { name: options.entityName }
          )
        )
      } catch (error) {
        if (error instanceof WatchlistDocumentError) {
          throw new SavedEntityPersistenceError(error.status, error.message)
        }
        if (isUniqueConstraintViolation(error)) {
          throw new SavedEntityPersistenceError(409, 'Watchlist contains a duplicate listing')
        }
        throw error
      }
  }

  if (persisted.length === 0) {
    throw new SavedEntityPersistenceError(
      404,
      `Saved ${entityKind} ${entityId} was not found while materializing Yjs state`
    )
  }

  return normalizeSavedEntityFields(entityKind, fields)
}

export async function applySavedEntityState(
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  entityId: string,
  fields: Record<string, unknown>,
  options?: SavedEntityApplyOptions
): Promise<Record<string, unknown>> {
  const normalizedFields = normalizeSavedEntityFields(entityKind, fields)
  try {
    return await applyEntityStateInSocketServer(entityId, entityKind, normalizedFields, options)
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
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  entityId: string,
  doc: Y.Doc,
  options?: SavedEntityApplyOptions
): Promise<Record<string, unknown>> {
  if (options?.entityName !== undefined && entityKind !== 'watchlist') {
    throw new SavedEntityPersistenceError(400, 'entityName is only supported for watchlist')
  }
  let entityFields: Record<string, unknown>
  try {
    entityFields = getEntityFields(doc, entityKind)
  } catch (error) {
    throw new SavedEntityPersistenceError(
      400,
      error instanceof Error ? error.message : 'Invalid saved entity fields'
    )
  }
  const yjsFields = normalizeSavedEntityFields(entityKind, entityFields)
  const workspaceId = getEntityWorkspaceId(doc)
  if (!workspaceId) {
    throw new SavedEntityPersistenceError(
      404,
      `Saved ${entityKind} ${entityId} workspace is missing while materializing Yjs state`
    )
  }
  const persistedFields = await persistSavedEntityState(
    entityKind,
    entityId,
    yjsFields,
    workspaceId,
    options
  )
  seedEntitySession(doc, { entityKind, payload: persistedFields })
  return persistedFields
}

export async function saveDashboardLayoutYjsDocToDb(
  entityId: string,
  doc: Y.Doc
): Promise<Record<string, unknown>> {
  const workspaceId = getEntityWorkspaceId(doc)
  if (!workspaceId) {
    throw new SavedEntityPersistenceError(
      404,
      `Saved dashboard_layout ${entityId} workspace is missing while materializing Yjs state`
    )
  }
  const ownerUserId = getEntityOwnerUserId(doc)
  if (!ownerUserId) {
    throw new SavedEntityPersistenceError(400, 'Dashboard layout ownerUserId is required')
  }

  let batch
  try {
    batch = beginDashboardLayoutDirtyFlush(doc)
  } catch (error) {
    throw new SavedEntityPersistenceError(
      500,
      error instanceof Error ? error.message : 'Dashboard layout persistence tracker is missing'
    )
  }
  if (!batch) {
    try {
      return readDashboardLayoutContent(doc)
    } catch (error) {
      throw new SavedEntityPersistenceError(
        400,
        error instanceof Error ? error.message : 'Dashboard layout Yjs state is invalid'
      )
    }
  }

  try {
    const content = await persistDashboardLayoutDirtyChannels(
      { workspaceId, ownerUserId },
      entityId,
      doc,
      batch
    )
    completeDashboardLayoutDirtyFlush(doc, batch)
    return content
  } catch (error) {
    failDashboardLayoutDirtyFlush(doc, batch)
    if (error instanceof DashboardLayoutOperationError) {
      throw new SavedEntityPersistenceError(error.status, error.message)
    }
    if (isUniqueConstraintViolation(error)) {
      throw new SavedEntityPersistenceError(
        409,
        'Dashboard widget identity conflicts with another layout'
      )
    }
    throw new SavedEntityPersistenceError(
      500,
      error instanceof Error ? error.message : 'Dashboard layout persistence failed'
    )
  }
}
