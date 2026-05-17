import * as Y from 'yjs'
import type {
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getEntityFields } from '@/lib/yjs/entity-session'
import { getYjsSnapshot, SocketServerBridgeError } from '@/lib/yjs/server/snapshot-bridge'

export type SavedEntityKind = Exclude<ReviewEntityKind, 'workflow'>

type SavedEntityRow = {
  id: string
  workspaceId: string | null
  [key: string]: any
}

function parseObjectJson(value: unknown, fieldName: string): Record<string, unknown> {
  const parsed = JSON.parse(String(value ?? ''))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function buildSavedEntityYjsDescriptor(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): ReviewTargetDescriptor {
  return {
    workspaceId,
    entityKind,
    entityId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: entityId,
  }
}

export function savedEntityRowToFields(
  entityKind: SavedEntityKind,
  row: SavedEntityRow
): Record<string, unknown> {
  switch (entityKind) {
    case 'skill':
      return {
        name: row.name ?? '',
        description: row.description ?? '',
        content: row.content ?? '',
      }
    case 'custom_tool':
      return {
        title: row.title ?? '',
        schemaText:
          typeof row.schema === 'string' ? row.schema : JSON.stringify(row.schema ?? {}, null, 2),
        codeText: row.code ?? '',
      }
    case 'indicator':
      return {
        name: row.name ?? '',
        color: row.color ?? '',
        pineCode: row.pineCode ?? '',
        inputMeta:
          row.inputMeta && typeof row.inputMeta === 'object' && !Array.isArray(row.inputMeta)
            ? row.inputMeta
            : null,
      }
    case 'mcp_server':
      return {
        name: row.name ?? '',
        description: row.description ?? '',
        transport: row.transport ?? 'http',
        url: row.url ?? '',
        headers:
          row.headers && typeof row.headers === 'object' && !Array.isArray(row.headers)
            ? row.headers
            : {},
        command: row.command ?? '',
        args: Array.isArray(row.args) ? row.args : [],
        env: row.env && typeof row.env === 'object' && !Array.isArray(row.env) ? row.env : {},
        timeout: row.timeout ?? 30000,
        retries: row.retries ?? 3,
        enabled: row.enabled ?? true,
      }
  }
}

export function applySavedEntityFieldsToRow<T extends SavedEntityRow>(
  entityKind: SavedEntityKind,
  row: T,
  fields: Record<string, unknown>
): T {
  switch (entityKind) {
    case 'skill':
      return {
        ...row,
        name: String(fields.name ?? ''),
        description: String(fields.description ?? ''),
        content: String(fields.content ?? ''),
      }
    case 'custom_tool':
      return {
        ...row,
        title: String(fields.title ?? ''),
        schema: parseObjectJson(fields.schemaText, 'schemaText'),
        code: String(fields.codeText ?? ''),
      }
    case 'indicator':
      return {
        ...row,
        name: String(fields.name ?? ''),
        color: String(fields.color ?? ''),
        pineCode: String(fields.pineCode ?? ''),
        inputMeta:
          fields.inputMeta &&
          typeof fields.inputMeta === 'object' &&
          !Array.isArray(fields.inputMeta)
            ? fields.inputMeta
            : null,
      }
    case 'mcp_server':
      return {
        ...row,
        name: String(fields.name ?? ''),
        description: String(fields.description ?? ''),
        transport: String(fields.transport ?? 'http'),
        url: String(fields.url ?? ''),
        headers:
          fields.headers && typeof fields.headers === 'object' && !Array.isArray(fields.headers)
            ? fields.headers
            : {},
        command: String(fields.command ?? ''),
        args: Array.isArray(fields.args) ? fields.args : [],
        env:
          fields.env && typeof fields.env === 'object' && !Array.isArray(fields.env)
            ? fields.env
            : {},
        timeout: Number(fields.timeout ?? 30000),
        retries: Number(fields.retries ?? 3),
        enabled: fields.enabled !== false,
      }
  }
}

export async function readSavedEntityFieldsFromYjs(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown> | null> {
  try {
    const descriptor = buildSavedEntityYjsDescriptor(entityKind, entityId, workspaceId)
    const snapshot = await getYjsSnapshot(
      entityId,
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    )

    if (!snapshot.snapshotBase64) {
      return null
    }

    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
      return getEntityFields(doc, entityKind)
    } finally {
      doc.destroy()
    }
  } catch (error) {
    if (error instanceof SocketServerBridgeError && error.status === 404) {
      return null
    }
    throw error
  }
}

export async function applySavedEntityYjsStateToRow<T extends SavedEntityRow>(
  entityKind: SavedEntityKind,
  row: T
): Promise<T> {
  if (!row.workspaceId) {
    return row
  }

  const fields = await readSavedEntityFieldsFromYjs(entityKind, row.id, row.workspaceId)
  return fields ? applySavedEntityFieldsToRow(entityKind, row, fields) : row
}

export async function applySavedEntityYjsStateToRows<T extends SavedEntityRow>(
  entityKind: SavedEntityKind,
  rows: T[]
): Promise<T[]> {
  return Promise.all(rows.map((row) => applySavedEntityYjsStateToRow(entityKind, row)))
}
