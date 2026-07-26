import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { isEqual } from 'lodash'
import type * as Y from 'yjs'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import {
  parseDashboardColorPairSessionId,
  parseDashboardWidgetSessionId,
} from '@/lib/copilot/review-sessions/identity'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import {
  DashboardLayoutOperationError,
  type DashboardLayoutOwnerScope,
  persistDashboardWidgetAndColorPairDocuments,
} from '@/lib/dashboard-layouts/operations'
import {
  renameSavedEntityIdentityInTx,
  SavedEntityIdentityError,
  type SavedEntityIdentityMutation,
} from '@/lib/saved-entities/identity'
import {
  materializeWatchlistDocumentInTx,
  type WatchlistDocumentTx,
} from '@/lib/watchlists/document'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import {
  readDashboardColorPairDocument,
  readDashboardWidgetStorageDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { getEntityFields, seedEntitySession } from '@/lib/yjs/entity-session'
import {
  type SavedEntityKind,
  SavedEntityPersistenceError,
  SavedEntityRealtimeRequiredError,
} from '@/lib/yjs/entity-state'
import { lockSavedEntityList } from '@/lib/yjs/server/entity-loaders'
import {
  beginRealtimeMutationTransaction,
  type RealtimeMutation,
} from '@/lib/yjs/server/mutation-idempotency'
import {
  applyEntityStateInSocketServer,
  SocketServerBridgeError,
} from '@/lib/yjs/server/snapshot-bridge'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { DashboardLayoutValidationError } from '@/widgets/layout-document'

export function toSavedEntityTransportError(error: unknown): SavedEntityPersistenceError | null {
  if (error instanceof SavedEntityPersistenceError) return error
  if (!(error instanceof SocketServerBridgeError)) return null
  if (
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 425 &&
    error.status !== 429
  ) {
    return new SavedEntityPersistenceError(error.status, error.message)
  }
  return new SavedEntityRealtimeRequiredError()
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
    return normalizeEntityFields(entityKind, fields)
  } catch (error) {
    throw new SavedEntityPersistenceError(
      400,
      error instanceof Error ? error.message : 'Invalid saved entity fields'
    )
  }
}

export async function persistSavedEntityStateInTx(
  tx: WatchlistDocumentTx,
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  entityId: string,
  fields: Record<string, unknown>,
  workspaceId: string
): Promise<Record<string, unknown>> {
  const now = new Date()
  let persisted: Array<{ id: string }>

  switch (entityKind) {
    case 'skill': {
      persisted = await tx
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
      persisted = await tx
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
      persisted = await tx
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
      persisted = await tx
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
      persisted = await tx
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
        return await materializeWatchlistDocumentInTx(tx, workspaceId, entityId, fields)
      } catch (error) {
        if (error instanceof WatchlistDocumentError) {
          throw new SavedEntityPersistenceError(error.status, error.message)
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
  workspaceId: string,
  actorUserId: string,
  fields: Record<string, unknown>,
  options?: {
    expectedReviewBaseStateHash?: string
    identity?: SavedEntityIdentityMutation
  }
): Promise<Record<string, unknown>> {
  const normalizedFields = normalizeSavedEntityFields(entityKind, fields)
  try {
    return await applyEntityStateInSocketServer(
      entityId,
      entityKind,
      workspaceId,
      actorUserId,
      normalizedFields,
      options
    )
  } catch (error) {
    if (error instanceof StructuredServerToolError) throw error
    throw toSavedEntityTransportError(error) ?? new SavedEntityRealtimeRequiredError()
  }
}

export async function saveSavedEntityYjsDocToDb(
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  entityId: string,
  workspaceId: string,
  doc: Y.Doc,
  options?: {
    identity?: SavedEntityIdentityMutation
    mutation?: RealtimeMutation
  }
): Promise<Record<string, unknown>> {
  let entityFields: Record<string, unknown>
  try {
    entityFields = getEntityFields(doc, entityKind)
  } catch (error) {
    throw new SavedEntityPersistenceError(
      400,
      error instanceof Error ? error.message : 'Invalid saved entity fields'
    )
  }
  const normalizedFields = normalizeSavedEntityFields(entityKind, entityFields)
  seedEntitySession(doc, { entityKind, payload: normalizedFields }, YJS_ORIGINS.SYSTEM)
  const canonicalFields = getEntityFields(doc, entityKind)
  try {
    const persistedFields = await db.transaction(async (tx) => {
      const complete = await beginRealtimeMutationTransaction(tx, options?.mutation, 30_000)
      await lockSavedEntityList(tx, entityKind, workspaceId)
      if (options?.identity) {
        await renameSavedEntityIdentityInTx(tx, {
          entityKind,
          entityId,
          workspaceId,
          name: options.identity.name,
        })
      }
      const result = await persistSavedEntityStateInTx(
        tx,
        entityKind,
        entityId,
        canonicalFields,
        workspaceId
      )
      return complete(result)
    })
    if (entityKind === 'watchlist' && isEqual(getEntityFields(doc, entityKind), canonicalFields)) {
      seedEntitySession(doc, { entityKind, payload: persistedFields }, YJS_ORIGINS.SYSTEM)
    }
    return persistedFields
  } catch (error) {
    if (error instanceof SavedEntityPersistenceError) throw error
    if (error instanceof SavedEntityIdentityError) {
      throw new SavedEntityPersistenceError(error.status, error.message, error.code)
    }
    throw error
  }
}

export async function saveDashboardYjsDocsToDb(
  scope: DashboardLayoutOwnerScope,
  parts: {
    layoutId: string
    widget?: { sessionId: string; doc: Y.Doc }
    colorPair?: { sessionId: string; doc: Y.Doc }
  },
  mutation?: RealtimeMutation
): Promise<{ widget?: Record<string, unknown>; colorPair?: Record<string, unknown> }> {
  const widget = parts.widget ? parseDashboardWidgetSessionId(parts.widget.sessionId) : null
  const colorPair = parts.colorPair
    ? parseDashboardColorPairSessionId(parts.colorPair.sessionId)
    : null
  if (
    !parts.layoutId ||
    (parts.widget && !widget) ||
    (parts.colorPair && !colorPair) ||
    (widget && widget.layoutId !== parts.layoutId) ||
    (colorPair && colorPair.layoutId !== parts.layoutId)
  ) {
    throw new SavedEntityPersistenceError(400, 'Invalid dashboard child sessions')
  }
  try {
    return await persistDashboardWidgetAndColorPairDocuments(
      scope,
      parts.layoutId,
      {
        ...(widget
          ? {
              widget: {
                identityId: widget.identityId,
                content: readDashboardWidgetStorageDocument(parts.widget!.doc),
              },
            }
          : {}),
        ...(colorPair
          ? {
              colorPair: {
                color: colorPair.color,
                content: readDashboardColorPairDocument(parts.colorPair!.doc),
              },
            }
          : {}),
      },
      mutation
    )
  } catch (error) {
    if (error instanceof DashboardLayoutValidationError) {
      throw new SavedEntityPersistenceError(400, error.message)
    }
    if (error instanceof DashboardLayoutOperationError) {
      throw new SavedEntityPersistenceError(error.status, error.message)
    }
    throw error
  }
}
