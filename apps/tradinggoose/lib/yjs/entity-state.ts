import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

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

function parseEntitySchemaText(schemaText: unknown): unknown {
  if (typeof schemaText !== 'string') {
    return schemaText ?? {}
  }
  try {
    return JSON.parse(schemaText)
  } catch {
    return {}
  }
}

/**
 * Canonical inverse of {@link savedEntityRowToFields}. The Yjs document field
 * names mirror the entity's editable row columns 1:1 for every kind, so the
 * inverse is identity — except custom_tool, whose schema/code are stored as
 * editable text (schemaText/codeText) and parsed back to row columns here.
 */
export function savedEntityFieldsToRow(
  entityKind: SavedEntityKind,
  fields: Record<string, unknown>
): Record<string, unknown> {
  if (entityKind === 'custom_tool') {
    return {
      title: fields.title,
      schema: parseEntitySchemaText(fields.schemaText),
      code: fields.codeText,
    }
  }
  return fields
}
