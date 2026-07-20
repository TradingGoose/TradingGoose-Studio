/**
 * Entity Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative entity session
 * and provides helpers to seed and read the live entity field state.
 *
 * Top-level collections:
 *   - "fields"   (Y.Map) — entity-kind-specific editable field values
 *   - "metadata"  (Y.Map) — bootstrap and runtime metadata. Authorization and
 *                            persistence scope always come from the authenticated
 *                            transport descriptor, never this collaborative map.
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
 *   - dashboard_layout: delegated to the topology-only layout document;
 *                       widget and color-pair child documents have separate
 *                       Yjs owners and never enter this entity fields map
 */

import { isEqual } from 'lodash'
import { validate as isUuid } from 'uuid'
import * as Y from 'yjs'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import type { WatchlistDocumentInputItem, WatchlistItem } from '@/lib/watchlists/types'
import {
  normalizeWatchlistDocumentContent,
  resolveWatchlistDocumentItemIds,
  WatchlistDocumentError,
  WatchlistYjsItemSchema,
  watchlistListingMembershipKey,
} from '@/lib/watchlists/validation'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/mcp-defaults'

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function getFieldsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('fields')
}

function getWatchlistItemsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  const fields = getFieldsMap(doc)
  const current = fields.get('items')
  if (current instanceof Y.Map) return current as Y.Map<Y.Map<unknown>>
  if (current !== undefined) throw new Error('Watchlist items must be a Y.Map')

  const items = new Y.Map<Y.Map<unknown>>()
  fields.set('items', items)
  return items
}

const setMapValue = (map: Y.Map<unknown>, key: string, value: unknown) => {
  if (map.get(key) !== value) map.set(key, value)
}

function writeWatchlistItem(
  items: Y.Map<Y.Map<unknown>>,
  item: WatchlistDocumentInputItem & { id: string },
  order: number
): void {
  let entry = items.get(item.id)
  if (!(entry instanceof Y.Map)) {
    entry = new Y.Map<unknown>()
    items.set(item.id, entry)
  }
  setMapValue(entry, 'type', item.type)
  setMapValue(entry, 'parentId', item.parentId ?? null)
  setMapValue(entry, 'order', order)
  if (item.type === 'section') {
    entry.delete('listing')
    setMapValue(entry, 'label', item.label)
  } else {
    entry.delete('label')
    const currentListing = entry.get('listing') as ListingIdentity | undefined
    if (!areListingIdentitiesEqual(currentListing, item.listing)) {
      entry.set('listing', item.listing)
    }
  }
}

function siblingOrders(
  items: WatchlistDocumentInputItem[]
): Map<WatchlistDocumentInputItem, number> {
  const result = new Map<WatchlistDocumentInputItem, number>()
  const nextByParent = new Map<string | null, number>()
  for (const item of items) {
    const parent = item.parentId ?? null
    const next = nextByParent.get(parent) ?? 0
    nextByParent.set(parent, next + 1)
    result.set(item, next)
  }
  return result
}

export function replaceWatchlistItems(
  doc: Y.Doc,
  rawItems: unknown,
  origin: unknown = YJS_ORIGINS.USER
): void {
  const normalized = normalizeWatchlistDocumentContent({
    settings: { showLogo: true, showTicker: true, showDescription: true },
    items: rawItems,
  }).items
  const items = resolveWatchlistDocumentItemIds(
    normalized,
    new Set(normalized.flatMap((item) => (item.id ? [item.id] : [])))
  )
  const orders = siblingOrders(items)
  doc.transact(() => {
    const map = getWatchlistItemsMap(doc)
    const keys = new Set(items.map((item) => item.id))
    map.forEach((_entry, key) => {
      if (!keys.has(key)) map.delete(key)
    })
    for (const item of items) {
      writeWatchlistItem(map, item, orders.get(item) ?? 0)
    }
  }, origin)
}

export function updateWatchlistItems(
  doc: Y.Doc,
  update: (items: WatchlistItem[]) => WatchlistItem[],
  origin: unknown = YJS_ORIGINS.USER
): void {
  replaceWatchlistItems(doc, update(readWatchlistItems(doc)), origin)
}

export function readWatchlistItems(doc: Y.Doc): WatchlistItem[] {
  const parsedEntries: Array<WatchlistItem & { order: number }> = []
  const items = getFieldsMap(doc).get('items')
  if (items === undefined) return []
  if (!(items instanceof Y.Map)) throw new Error('Watchlist items must be a Y.Map')
  const itemMap = items as Y.Map<Y.Map<unknown>>
  itemMap.forEach((entry, key) => {
    const parsed = entry instanceof Y.Map ? WatchlistYjsItemSchema.safeParse(entry.toJSON()) : null
    if (!parsed?.success) {
      throw new WatchlistDocumentError('Invalid watchlist item')
    }
    const item = parsed.data
    if (!isUuid(key)) {
      throw new WatchlistDocumentError('Invalid watchlist item')
    }
    parsedEntries.push({ id: key, ...item })
  })

  parsedEntries.sort((left, right) => left.id.localeCompare(right.id))
  const sectionIds = new Set(
    parsedEntries.flatMap((entry) => (entry.type === 'section' ? [entry.id] : []))
  )
  const memberships = new Set<string>()
  const entries: Array<WatchlistItem & { order: number }> = []
  for (const entry of parsedEntries) {
    if (entry.type === 'section') {
      entries.push(entry)
      continue
    }
    const projected = {
      ...entry,
      parentId: entry.parentId && sectionIds.has(entry.parentId) ? entry.parentId : null,
    }
    const membership = watchlistListingMembershipKey(projected.parentId, projected.listing)
    if (memberships.has(membership)) continue
    memberships.add(membership)
    entries.push(projected)
  }

  const byParent = new Map<string | null, Array<WatchlistItem & { order: number }>>()
  for (const item of entries) {
    const parentId = item.parentId ?? null
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), item])
  }
  const sortItems = (items: Array<WatchlistItem & { order: number }>) =>
    items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))

  const output: WatchlistItem[] = []
  for (const item of sortItems(byParent.get(null) ?? [])) {
    const { order: _order, ...value } = item
    output.push(value)
    if (value.type === 'section') {
      for (const child of sortItems(byParent.get(value.id) ?? [])) {
        const { order: _childOrder, ...childValue } = child
        output.push(childValue)
      }
    }
  }
  return output
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
export function seedEntitySession(
  doc: Y.Doc,
  options: EntitySessionSeedOptions,
  origin: unknown = YJS_ORIGINS.SYSTEM
): void {
  const { entityKind, payload } = options

  doc.transact(() => {
    const fields = getFieldsMap(doc)
    const setField = (key: string, value: unknown) => {
      if (!isEqual(fields.get(key), value)) fields.set(key, value)
    }

    switch (entityKind) {
      case 'skill':
        setField('description', payload.description ?? '')
        setField('content', payload.content ?? '')
        break

      case 'custom_tool': {
        replaceEntityTextField(doc, 'schemaText', payload.schemaText ?? '', origin)
        replaceEntityTextField(doc, 'codeText', payload.codeText ?? '', origin)
        break
      }

      case 'indicator': {
        setField('color', payload.color ?? '')
        replaceEntityTextField(doc, 'pineCode', payload.pineCode ?? '', origin)
        break
      }

      case 'knowledge_base':
        setField('description', payload.description ?? '')
        setField('chunkingConfig', payload.chunkingConfig)
        if ('tokenCount' in payload) setField('tokenCount', payload.tokenCount ?? 0)
        if ('embeddingModel' in payload) {
          setField('embeddingModel', payload.embeddingModel ?? 'text-embedding-3-small')
        }
        if ('embeddingDimension' in payload) {
          setField('embeddingDimension', payload.embeddingDimension ?? 1536)
        }
        break

      case 'mcp_server':
        setField('description', payload.description ?? MCP_SERVER_DEFAULTS.description)
        setField('transport', payload.transport ?? 'http')
        setField('url', payload.url ?? MCP_SERVER_DEFAULTS.url)
        setField('headers', payload.headers ?? {})
        setField('command', payload.command ?? MCP_SERVER_DEFAULTS.command)
        setField('args', payload.args ?? [])
        setField('env', payload.env ?? {})
        setField('timeout', payload.timeout ?? MCP_SERVER_DEFAULTS.timeout)
        setField('retries', payload.retries ?? MCP_SERVER_DEFAULTS.retries)
        setField('enabled', payload.enabled ?? MCP_SERVER_DEFAULTS.enabled)
        break

      case 'watchlist': {
        const watchlist = normalizeWatchlistDocumentContent(payload)
        setField('settings', watchlist.settings)
        replaceWatchlistItems(doc, watchlist.items, origin)
        break
      }
    }
  }, origin)
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
        items: readWatchlistItems(doc),
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
    if (text.toString() === value) return
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
