import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'

export type SavedEntityKind = Exclude<ReviewEntityKind, 'workflow'>

type SavedEntityRow = {
  id: string
  workspaceId: string | null
  [key: string]: any
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
    case 'knowledge_base':
      return {
        name: row.name ?? '',
        description: row.description ?? '',
        chunkingConfig: row.chunkingConfig,
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

export async function applySavedEntityRows<T extends SavedEntityRow>(
  entityKind: SavedEntityKind,
  rows: T[],
  options?: { rollbackRows?: () => Promise<void> }
): Promise<void> {
  try {
    await Promise.all(
      rows.map((row) =>
        applySavedEntityState(entityKind, row.id, savedEntityRowToFields(entityKind, row))
      )
    )
  } catch (error) {
    await options?.rollbackRows?.()
    throw error
  }
}
