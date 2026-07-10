/**
 * Entity Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative entity session
 * and provides helpers to seed and read the live entity field state.
 *
 * Top-level collections:
 *   - "fields"   (Y.Map) — entity-kind-specific editable field values
 *   - "metadata"  (Y.Map) — session-level metadata: the resolved `workspaceId`
 *                            that owns the entity (its canonical persistence
 *                            scope), plus bootstrap state.
 *   - "members"   (Y.Map) — entity-list sessions only. List discovery metadata
 *                            is mutated explicitly by create/update/delete flows,
 *                            never inferred from a saved entity document.
 *
 * Entity-kind adapters:
 *   - skill:        description, content
 *   - custom_tool:  schemaText (Y.Text), codeText (Y.Text)
 *   - indicator:    color, pineCode (Y.Text)
 *   - knowledge_base: description, chunkingConfig
 *   - mcp_server:   description, transport, url, headers, command,
 *                    args, env, timeout, retries, enabled
 *   - watchlist:    settings, items
 *   - dashboard_layout: delegated to its owner-scoped layout session with
 *                       layout, widgets, and colorPairs child maps
 */

import * as Y from 'yjs'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { normalizeWatchlistDocumentContent } from '@/lib/watchlists/validation'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/mcp-defaults'

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function getFieldsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('fields')
}

function getEntityMetadataMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('metadata')
}

export interface EntityListMember {
  entityId: string
  entityName: string
  entityDescription?: string
  enabled?: boolean
  folderId?: string | null
  color?: string
  createdAt?: string
  updatedAt?: string
  connectionStatus?: string
  isActive?: boolean
  sortOrder?: number
}

function getEntityListMembersMap(doc: Y.Doc): Y.Map<{
  name: string
  description?: string
  enabled?: boolean
  folderId?: string | null
  color?: string
  createdAt?: string
  updatedAt?: string
  connectionStatus?: string
  isActive?: boolean
  sortOrder?: number
  deleted?: boolean
}> {
  return doc.getMap('members')
}

export function replaceEntityListSessionMembers(
  doc: Y.Doc,
  members: Array<{
    id: string
    name: string
    description?: string
    enabled?: boolean
    folderId?: string | null
    color?: string
    createdAt?: string
    updatedAt?: string
    connectionStatus?: string
    isActive?: boolean
    sortOrder?: number
  }>
): void {
  doc.transact(() => {
    const listMembers = getEntityListMembersMap(doc)
    const memberIds = new Set(members.map((member) => member.id))
    listMembers.forEach((_value, entityId) => {
      if (!memberIds.has(entityId)) listMembers.delete(entityId)
    })
    for (const member of members) {
      const next = {
        name: member.name,
        ...(typeof member.description === 'string' ? { description: member.description } : {}),
        ...(typeof member.enabled === 'boolean' ? { enabled: member.enabled } : {}),
        ...('folderId' in member ? { folderId: member.folderId ?? null } : {}),
        ...(typeof member.color === 'string' ? { color: member.color } : {}),
        ...(typeof member.createdAt === 'string' ? { createdAt: member.createdAt } : {}),
        ...(typeof member.updatedAt === 'string' ? { updatedAt: member.updatedAt } : {}),
        ...(typeof member.connectionStatus === 'string'
          ? { connectionStatus: member.connectionStatus }
          : {}),
        ...(typeof member.isActive === 'boolean' ? { isActive: member.isActive } : {}),
        ...(typeof member.sortOrder === 'number' ? { sortOrder: member.sortOrder } : {}),
      }
      const current = listMembers.get(member.id)
      if (
        current?.deleted ||
        current?.name !== next.name ||
        current?.description !== next.description ||
        current?.enabled !== next.enabled ||
        current?.folderId !== next.folderId ||
        current?.color !== next.color ||
        current?.createdAt !== next.createdAt ||
        current?.updatedAt !== next.updatedAt ||
        current?.connectionStatus !== next.connectionStatus ||
        current?.isActive !== next.isActive ||
        current?.sortOrder !== next.sortOrder
      ) {
        listMembers.set(member.id, next)
      }
    }
  }, YJS_ORIGINS.SYSTEM)
}

export function getEntityListMembers(doc: Y.Doc, entityKind: ReviewEntityKind): EntityListMember[] {
  const entries: EntityListMember[] = []
  getEntityListMembersMap(doc).forEach((value, entityId) => {
    if (value?.deleted) return
    entries.push({
      entityId,
      entityName: typeof value?.name === 'string' ? value.name : '',
      ...(typeof value?.description === 'string' ? { entityDescription: value.description } : {}),
      ...(typeof value?.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(value && 'folderId' in value ? { folderId: value.folderId ?? null } : {}),
      ...(typeof value?.color === 'string' ? { color: value.color } : {}),
      ...(typeof value?.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
      ...(typeof value?.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
      ...(typeof value?.connectionStatus === 'string'
        ? { connectionStatus: value.connectionStatus }
        : {}),
      ...(typeof value?.isActive === 'boolean' ? { isActive: value.isActive } : {}),
      ...(typeof value?.sortOrder === 'number' ? { sortOrder: value.sortOrder } : {}),
    })
  })
  entries.sort((a, b) => {
    if (entityKind === 'dashboard_layout') {
      return (
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0) ||
        a.entityId.localeCompare(b.entityId)
      )
    }
    const nameOrder = a.entityName.localeCompare(b.entityName)
    return nameOrder || a.entityId.localeCompare(b.entityId)
  })
  return entries
}

/**
 * Metadata key carrying the workspace that owns the entity. Resolved once when
 * the entity doc is bootstrapped and used as the authoritative scope when
 * materializing the doc back to its canonical DB row.
 */
const ENTITY_METADATA_WORKSPACE_ID_KEY = 'workspaceId'
const ENTITY_METADATA_OWNER_USER_ID_KEY = 'ownerUserId'

export function getEntityWorkspaceId(doc: Y.Doc): string | null {
  const value = getEntityMetadataMap(doc).get(ENTITY_METADATA_WORKSPACE_ID_KEY)
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function getEntityOwnerUserId(doc: Y.Doc): string | null {
  const value = getEntityMetadataMap(doc).get(ENTITY_METADATA_OWNER_USER_ID_KEY)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Writes (or clears) the owner scope on an entity doc's metadata map. The only
 * canonical writer for `ownerUserId` metadata — callers must not hand-roll the
 * metadata key.
 */
export function setEntityOwnerUserId(
  metadata: Y.Map<any>,
  ownerUserId: string | null | undefined
): void {
  if (ownerUserId) {
    metadata.set(ENTITY_METADATA_OWNER_USER_ID_KEY, ownerUserId)
  } else {
    metadata.delete(ENTITY_METADATA_OWNER_USER_ID_KEY)
  }
}

// ---------------------------------------------------------------------------
// Seed options
// ---------------------------------------------------------------------------

interface EntitySessionSeedOptions {
  entityKind: Exclude<ReviewEntityKind, 'workflow' | 'dashboard_layout'>
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
        fields.set('description', payload.description ?? '')
        fields.set('content', payload.content ?? '')
        break

      case 'custom_tool': {
        // schemaText and codeText are Y.Text for Monaco binding
        const schemaText = new Y.Text()
        schemaText.insert(0, payload.schemaText ?? '')
        fields.set('schemaText', schemaText)
        const codeText = new Y.Text()
        codeText.insert(0, payload.codeText ?? '')
        fields.set('codeText', codeText)
        break
      }

      case 'indicator': {
        fields.set('color', payload.color ?? '')
        const pineCode = new Y.Text()
        pineCode.insert(0, payload.pineCode ?? '')
        fields.set('pineCode', pineCode)
        break
      }

      case 'knowledge_base':
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

      case 'watchlist': {
        const watchlist = normalizeWatchlistDocumentContent(payload)
        fields.set('settings', watchlist.settings)
        fields.set('items', watchlist.items)
        break
      }
    }
  }, YJS_ORIGINS.SYSTEM)
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Reads the current entity fields from the Yjs doc.
 */
export function getEntityFields(
  doc: Y.Doc,
  entityKind: Exclude<ReviewEntityKind, 'workflow' | 'dashboard_layout'>
): Record<string, any> {
  const fields = getFieldsMap(doc)
  const result: Record<string, any> = {}

  switch (entityKind) {
    case 'skill':
      result.description = fields.get('description') ?? ''
      result.content = fields.get('content') ?? ''
      break

    case 'custom_tool':
      result.schemaText = fields.get('schemaText')?.toString() ?? ''
      result.codeText = fields.get('codeText')?.toString() ?? ''
      break

    case 'indicator':
      result.color = fields.get('color') ?? ''
      result.pineCode = fields.get('pineCode')?.toString() ?? ''
      break

    case 'knowledge_base':
      result.description = fields.get('description') ?? ''
      result.chunkingConfig = fields.get('chunkingConfig')
      result.tokenCount = fields.get('tokenCount') ?? 0
      result.embeddingModel = fields.get('embeddingModel') ?? 'text-embedding-3-small'
      result.embeddingDimension = fields.get('embeddingDimension') ?? 1536
      break

    case 'mcp_server':
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

    case 'watchlist':
      return normalizeWatchlistDocumentContent({
        settings: fields.get('settings'),
        items: fields.get('items'),
      })
  }

  return result
}

function ensureEntityTextField(doc: Y.Doc, key: string, initialValue = ''): Y.Text {
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
