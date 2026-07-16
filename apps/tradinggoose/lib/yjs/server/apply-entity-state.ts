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
import { getEntityFields } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { lockSavedEntityList } from '@/lib/yjs/server/entity-loaders'
import { applyEntityStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { DashboardLayoutValidationError } from '@/widgets/layout-document'

export class SavedEntityPersistenceError extends Error {
  readonly retryable: boolean

  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'SavedEntityPersistenceError'
    this.retryable = status >= 500
  }

  responseBody() {
    return {
      error: this.message,
      ...(this.code ? { code: this.code } : {}),
      retryable: this.retryable,
    }
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
  workspaceId: string,
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
      normalizedFields,
      options
    )
  } catch (error) {
    if (error instanceof StructuredServerToolError) throw error
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
  workspaceId: string,
  doc: Y.Doc,
  options?: { identity?: SavedEntityIdentityMutation }
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
  try {
    return await db.transaction(async (tx) => {
      await lockSavedEntityList(tx, entityKind, workspaceId)
      if (options?.identity) {
        await renameSavedEntityIdentityInTx(tx, {
          entityKind,
          entityId,
          workspaceId,
          name: options.identity.name,
        })
      }
      return persistSavedEntityStateInTx(tx, entityKind, entityId, normalizedFields, workspaceId)
    })
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
    widget?: { sessionId: string; doc: Y.Doc }
    colorPair?: { sessionId: string; doc: Y.Doc }
  }
): Promise<{ widget?: Record<string, unknown>; colorPair?: Record<string, unknown> }> {
  const widget = parts.widget ? parseDashboardWidgetSessionId(parts.widget.sessionId) : null
  const colorPair = parts.colorPair
    ? parseDashboardColorPairSessionId(parts.colorPair.sessionId)
    : null
  const layoutId = widget?.layoutId ?? colorPair?.layoutId
  if (
    !layoutId ||
    (parts.widget && !widget) ||
    (parts.colorPair && !colorPair) ||
    (widget && colorPair && widget.layoutId !== colorPair.layoutId)
  ) {
    throw new SavedEntityPersistenceError(400, 'Invalid dashboard child sessions')
  }
  try {
    return await persistDashboardWidgetAndColorPairDocuments(scope, layoutId, {
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
    })
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
