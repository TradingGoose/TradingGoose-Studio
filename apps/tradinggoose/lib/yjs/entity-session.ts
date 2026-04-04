/**
 * Entity Session Document Contract
 *
 * Defines the top-level Yjs collections for a collaborative entity session
 * and provides helpers to seed and read the live entity field state.
 *
 * Top-level collections:
 *   - "fields"   (Y.Map) — entity-kind-specific field values
 *   - "metadata"  (Y.Map) — session-level metadata (bootstrap-touch, etc.)
 *
 * Entity-kind adapters:
 *   - skill:        name, description, content
 *   - custom_tool:  title, schemaText (Y.Text), codeText (Y.Text)
 *   - indicator:    name, color, pineCode (Y.Text), inputMeta
 *   - mcp_server:   name, description, transport, url, headers, command,
 *                    args, env, timeout, retries, enabled
 */

import * as Y from 'yjs'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { MCP_SERVER_DEFAULTS } from '@/widgets/utils/draft-defaults'

// ---------------------------------------------------------------------------
// Top-level map accessors
// ---------------------------------------------------------------------------

export function getFieldsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('fields')
}

export function getEntityMetadataMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('metadata')
}

// ---------------------------------------------------------------------------
// Seed options
// ---------------------------------------------------------------------------

export interface EntitySessionSeedOptions {
  entityKind: ReviewEntityKind
  payload: Record<string, any>
  reviewModel?: string | null
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Seeds a brand-new entity Yjs doc from the draft default payload.
 * Called once per reviewSessionId/draftSessionId target.
 */
export function seedEntitySession(doc: Y.Doc, options: EntitySessionSeedOptions): void {
  const { entityKind, payload } = options

  doc.transact(() => {
    const fields = getFieldsMap(doc)
    const metadata = getEntityMetadataMap(doc)

    // Set bootstrap-touch marker
    metadata.set('bootstrap-touch', Date.now())
    if (options.reviewModel) {
      metadata.set('reviewModel', options.reviewModel)
    }

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
