import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { normalizePersistedWatchlistDocumentFields } from '@/lib/watchlists/validation'
import type { LayoutNode, PersistedColorPairsState } from '@/widgets/layout'

export type SavedEntityKind = Exclude<ReviewEntityKind, 'workflow'>

export type SavedEntityRow = {
  id: string
  workspaceId: string | null
  [key: string]: any
}

type DashboardLayoutEntityFields = {
  name: string
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  isActive: boolean
  sortOrder: number
}

export function normalizeDashboardLayoutEntityFields(
  fields: Record<string, unknown> | null | undefined
): DashboardLayoutEntityFields {
  return normalizeEntityFields('dashboard_layout', fields) as DashboardLayoutEntityFields
}

export class SavedEntityRealtimeRequiredError extends Error {
  readonly code = 'SAVED_ENTITY_REALTIME_REQUIRED'
  readonly status = 503
  readonly retryable = true

  constructor() {
    super('Saved entity realtime orchestration is required')
    this.name = 'SavedEntityRealtimeRequiredError'
  }

  responseBody() {
    return { error: this.message, code: this.code, retryable: this.retryable }
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
      }
    case 'knowledge_base':
      return {
        name: row.name ?? '',
        description: row.description ?? '',
        chunkingConfig: row.chunkingConfig,
        tokenCount: row.tokenCount ?? 0,
        embeddingModel: row.embeddingModel ?? 'text-embedding-3-small',
        embeddingDimension: row.embeddingDimension ?? 1536,
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
    case 'watchlist':
      return normalizePersistedWatchlistDocumentFields(row)
    case 'dashboard_layout':
      return normalizeDashboardLayoutEntityFields({
        name: row.name,
        layout: row.layout,
        colorPairs: row.color_pair,
        isActive: row.isActive,
        sortOrder: row.sort_order,
      })
  }
}
