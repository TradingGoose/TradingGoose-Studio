import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { normalizePersistedWatchlistDocumentFields } from '@/lib/watchlists/validation'

export type SavedEntityKind = Exclude<ReviewEntityKind, 'workflow'>

export type SavedEntityRow = {
  id: string
  workspaceId: string | null
  [key: string]: any
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

export function savedEntityRowToContent(
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  row: SavedEntityRow
): Record<string, unknown> {
  switch (entityKind) {
    case 'skill':
      return {
        description: row.description ?? '',
        content: row.content ?? '',
      }
    case 'custom_tool':
      return {
        schemaText:
          typeof row.schema === 'string' ? row.schema : JSON.stringify(row.schema ?? {}, null, 2),
        codeText: row.code ?? '',
      }
    case 'indicator':
      return {
        color: row.color ?? '',
        pineCode: row.pineCode ?? '',
      }
    case 'knowledge_base':
      return {
        description: row.description ?? '',
        chunkingConfig: row.chunkingConfig,
        tokenCount: row.tokenCount ?? 0,
        embeddingModel: row.embeddingModel ?? 'text-embedding-3-small',
        embeddingDimension: row.embeddingDimension ?? 1536,
      }
    case 'mcp_server':
      return {
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
    case 'watchlist': {
      const { name: _name, ...content } = normalizePersistedWatchlistDocumentFields(row)
      return content
    }
  }
}
