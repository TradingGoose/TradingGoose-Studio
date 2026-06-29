/**
 * Entity Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative entity session
 * and provides helpers to seed and read the live entity field state.
 *
 * Top-level collections:
 *   - "fields"   (Y.Map) — entity-kind-specific field values
 *   - "metadata"  (Y.Map) — session-level metadata: the resolved `workspaceId`
 *                            that owns the entity (its canonical persistence
 *                            scope), plus bootstrap-touch and identity markers.
 *
 * Entity-kind adapters:
 *   - skill:        name, description, content
 *   - custom_tool:  title, schemaText (Y.Text), codeText (Y.Text)
 *   - indicator:    name, color, pineCode (Y.Text), inputMeta
 *   - knowledge_base: name, description, chunkingConfig
 *   - mcp_server:   name, description, transport, url, headers, command,
 *                    args, env, timeout, retries, enabled
 */

import * as Y from 'yjs'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/mcp-defaults'

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function getFieldsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('fields')
}

export function getEntityMetadataMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('metadata')
}

export interface EntityListMember {
  entityId: string
  entityName: string
  enabled?: boolean
  folderId?: string | null
  color?: string
}

export type EntityListMemberMutation =
  | {
      op: 'upsert'
      entityId: string
      name: string
      enabled?: boolean
      folderId?: string | null
      color?: string
    }
  | { op: 'remove'; entityId: string }

function getEntityListMembersMap(doc: Y.Doc): Y.Map<{
  name: string
  enabled?: boolean
  folderId?: string | null
  color?: string
  deleted?: boolean
}> {
  return doc.getMap('members')
}

export function getEntityListMemberFromFields(
  entityKind: Exclude<ReviewEntityKind, 'workflow'>,
  entityId: string,
  fields: Record<string, unknown>
): { id: string; name: string; enabled?: boolean; color?: string } {
  const nameKey = entityKind === 'custom_tool' ? 'title' : 'name'
  return {
    id: entityId,
    name: String(fields[nameKey] ?? ''),
    ...(entityKind === 'mcp_server' ? { enabled: fields.enabled !== false } : {}),
    ...(entityKind === 'indicator' && typeof fields.color === 'string'
      ? { color: fields.color }
      : {}),
  }
}

export function seedEntityListSession(
  doc: Y.Doc,
  members: Array<{
    id: string
    name: string
    enabled?: boolean
    folderId?: string | null
    color?: string
  }>
): void {
  doc.transact(() => {
    const listMembers = getEntityListMembersMap(doc)
    for (const member of members) {
      listMembers.set(member.id, {
        name: member.name,
        ...(typeof member.enabled === 'boolean' ? { enabled: member.enabled } : {}),
        ...('folderId' in member ? { folderId: member.folderId ?? null } : {}),
        ...(typeof member.color === 'string' ? { color: member.color } : {}),
      })
    }
  }, YJS_ORIGINS.SYSTEM)
}

function applyEntityListMutation(doc: Y.Doc, mutation: EntityListMemberMutation): void {
  doc.transact(() => {
    getEntityListMembersMap(doc).set(
      mutation.entityId,
      mutation.op === 'upsert'
        ? {
            name: mutation.name,
            deleted: false,
            ...(typeof mutation.enabled === 'boolean' ? { enabled: mutation.enabled } : {}),
            ...('folderId' in mutation ? { folderId: mutation.folderId ?? null } : {}),
            ...(typeof mutation.color === 'string' ? { color: mutation.color } : {}),
          }
        : { name: '', deleted: true }
    )
  }, YJS_ORIGINS.SYSTEM)
}

export function applyEntityListMutations(
  doc: Y.Doc,
  mutations: EntityListMemberMutation | EntityListMemberMutation[]
): void {
  for (const mutation of Array.isArray(mutations) ? mutations : [mutations]) {
    applyEntityListMutation(doc, mutation)
  }
}

export function getEntityListMembers(doc: Y.Doc): EntityListMember[] {
  const entries: EntityListMember[] = []
  getEntityListMembersMap(doc).forEach((value, entityId) => {
    if (value?.deleted) return
    entries.push({
      entityId,
      entityName: typeof value?.name === 'string' ? value.name : '',
      ...(typeof value?.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(value && 'folderId' in value ? { folderId: value.folderId ?? null } : {}),
      ...(typeof value?.color === 'string' ? { color: value.color } : {}),
    })
  })
  entries.sort((a, b) => a.entityName.localeCompare(b.entityName))
  return entries
}

/**
 * Metadata key carrying the workspace that owns the entity. Resolved once when
 * the entity doc is bootstrapped and used as the authoritative scope when
 * materializing the doc back to its canonical DB row.
 */
export const ENTITY_METADATA_WORKSPACE_ID_KEY = 'workspaceId'

export function getEntityWorkspaceId(doc: Y.Doc): string | null {
  const value = getEntityMetadataMap(doc).get(ENTITY_METADATA_WORKSPACE_ID_KEY)
  return typeof value === 'string' && value.length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Seed options
// ---------------------------------------------------------------------------

export interface EntitySessionSeedOptions {
  entityKind: ReviewEntityKind
  payload: Record<string, any>
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Seeds an entity Yjs doc from canonical saved fields or draft defaults.
 */
export function seedEntitySession(doc: Y.Doc, options: EntitySessionSeedOptions): void {
  const { entityKind, payload } = options

  doc.transact(() => {
    const fields = getFieldsMap(doc)
    const metadata = getEntityMetadataMap(doc)

    // Set bootstrap-touch marker
    metadata.set('bootstrap-touch', Date.now())

    switch (entityKind) {
      case 'skill':
        fields.set('name', payload.name ?? '')
        fields.set('description', payload.description ?? '')
        fields.set('content', payload.content ?? '')
        break

      case 'custom_tool': {
        fields.set('title', payload.title ?? '')
        // schemaText and codeText are Y.Text for Monaco binding
        const schemaText = new Y.Text()
        schemaText.insert(0, payload.schemaText ?? payload.schema ?? '')
        fields.set('schemaText', schemaText)
        const codeText = new Y.Text()
        codeText.insert(0, payload.codeText ?? payload.code ?? '')
        fields.set('codeText', codeText)
        break
      }

      case 'indicator': {
        fields.set('name', payload.name ?? '')
        fields.set('color', payload.color ?? '')
        const pineCode = new Y.Text()
        pineCode.insert(0, payload.pineCode ?? '')
        fields.set('pineCode', pineCode)
        fields.set('inputMeta', payload.inputMeta ?? null)
        break
      }

      case 'knowledge_base':
        fields.set('name', payload.name ?? '')
        fields.set('description', payload.description ?? '')
        fields.set('chunkingConfig', payload.chunkingConfig)
        if ('tokenCount' in payload) fields.set('tokenCount', payload.tokenCount ?? 0)
        if ('embeddingModel' in payload) {
          fields.set('embeddingModel', payload.embeddingModel ?? 'text-embedding-3-small')
        }
        if ('embeddingDimension' in payload) {
          fields.set('embeddingDimension', payload.embeddingDimension ?? 1536)
        }
        break

      case 'mcp_server':
        fields.set('name', payload.name ?? MCP_SERVER_DEFAULTS.name)
        fields.set('description', payload.description ?? MCP_SERVER_DEFAULTS.description)
        fields.set('transport', payload.transport ?? 'http')
        fields.set('url', payload.url ?? MCP_SERVER_DEFAULTS.url)
        fields.set('headers', payload.headers ?? {})
        fields.set('command', payload.command ?? MCP_SERVER_DEFAULTS.command)
        fields.set('args', payload.args ?? [])
        fields.set('env', payload.env ?? {})
        fields.set('timeout', payload.timeout ?? MCP_SERVER_DEFAULTS.timeout)
        fields.set('retries', payload.retries ?? MCP_SERVER_DEFAULTS.retries)
        fields.set('enabled', payload.enabled ?? MCP_SERVER_DEFAULTS.enabled)
        break
    }
  }, YJS_ORIGINS.SYSTEM)
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Reads the current entity fields from the Yjs doc.
 */
export function getEntityFields(doc: Y.Doc, entityKind: ReviewEntityKind): Record<string, any> {
  const fields = getFieldsMap(doc)
  const result: Record<string, any> = {}

  switch (entityKind) {
    case 'skill':
      result.name = fields.get('name') ?? ''
      result.description = fields.get('description') ?? ''
      result.content = fields.get('content') ?? ''
      break

    case 'custom_tool':
      result.title = fields.get('title') ?? ''
      result.schemaText = fields.get('schemaText')?.toString() ?? ''
      result.codeText = fields.get('codeText')?.toString() ?? ''
      break

    case 'indicator':
      result.name = fields.get('name') ?? ''
      result.color = fields.get('color') ?? ''
      result.pineCode = fields.get('pineCode')?.toString() ?? ''
      result.inputMeta = fields.get('inputMeta')
      break

    case 'knowledge_base':
      result.name = fields.get('name') ?? ''
      result.description = fields.get('description') ?? ''
      result.chunkingConfig = fields.get('chunkingConfig')
      result.tokenCount = fields.get('tokenCount') ?? 0
      result.embeddingModel = fields.get('embeddingModel') ?? 'text-embedding-3-small'
      result.embeddingDimension = fields.get('embeddingDimension') ?? 1536
      break

    case 'mcp_server':
      result.name = fields.get('name') ?? MCP_SERVER_DEFAULTS.name
      result.description = fields.get('description') ?? MCP_SERVER_DEFAULTS.description
      result.transport = fields.get('transport') ?? 'http'
      result.url = fields.get('url') ?? MCP_SERVER_DEFAULTS.url
      result.headers = fields.get('headers') ?? {}
      result.command = fields.get('command') ?? MCP_SERVER_DEFAULTS.command
      result.args = fields.get('args') ?? []
      result.env = fields.get('env') ?? {}
      result.timeout = fields.get('timeout') ?? MCP_SERVER_DEFAULTS.timeout
      result.retries = fields.get('retries') ?? MCP_SERVER_DEFAULTS.retries
      result.enabled = fields.get('enabled') ?? MCP_SERVER_DEFAULTS.enabled
      break
  }

  return result
}

export function ensureEntityTextField(doc: Y.Doc, key: string, initialValue = ''): Y.Text {
  const fields = getFieldsMap(doc)
  const existing = fields.get(key)
  if (existing instanceof Y.Text) {
    return existing
  }

  const next = new Y.Text()
  if (initialValue) {
    next.insert(0, initialValue)
  }
  doc.transact(() => {
    fields.set(key, next)
  }, YJS_ORIGINS.SYSTEM)
  return next
}

export function replaceEntityTextField(
  doc: Y.Doc,
  key: string,
  value: string,
  origin: unknown = YJS_ORIGINS.USER
): void {
  const text = ensureEntityTextField(doc, key)
  doc.transact(() => {
    text.delete(0, text.length)
    if (value) {
      text.insert(0, value)
    }
  }, origin)
}

export function setEntityField(
  doc: Y.Doc,
  key: string,
  value: unknown,
  origin: unknown = YJS_ORIGINS.USER
): void {
  doc.transact(() => {
    getFieldsMap(doc).set(key, value)
  }, origin)
}
