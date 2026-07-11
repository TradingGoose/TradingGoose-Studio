import { z } from 'zod'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import {
  normalizeWatchlistDocumentContent,
  WatchlistContentDocumentSchema,
} from '@/lib/watchlists/validation'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  DashboardLayoutDocumentContentSchema,
  normalizeDashboardLayoutDocumentContent,
} from '@/widgets/layout-document'

export { DASHBOARD_LAYOUT_DOCUMENT_FORMAT } from '@/widgets/layout-document'
export const SKILL_DOCUMENT_FORMAT = 'tg-skill-document-v1' as const
export const CUSTOM_TOOL_DOCUMENT_FORMAT = 'tg-custom-tool-document-v1' as const
export const INDICATOR_DOCUMENT_FORMAT = 'tg-indicator-document-v1' as const
export const MCP_SERVER_DOCUMENT_FORMAT = 'tg-mcp-server-document-v1' as const
export const KNOWLEDGE_BASE_DOCUMENT_FORMAT = 'tg-knowledge-base-document-v1' as const
export const WORKFLOW_VARIABLE_DOCUMENT_FORMAT = 'tg-workflow-variable-document-v1' as const
export const WATCHLIST_DOCUMENT_FORMAT = 'tg-watchlist-document-v1' as const

const ENTITY_DOCUMENT_FORMATS = {
  skill: SKILL_DOCUMENT_FORMAT,
  custom_tool: CUSTOM_TOOL_DOCUMENT_FORMAT,
  indicator: INDICATOR_DOCUMENT_FORMAT,
  mcp_server: MCP_SERVER_DOCUMENT_FORMAT,
  knowledge_base: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
  watchlist: WATCHLIST_DOCUMENT_FORMAT,
  dashboard_layout: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
} as const

export type EntityDocumentKind = keyof typeof ENTITY_DOCUMENT_FORMATS

const SkillDocumentSchema = z
  .object({
    description: z.string(),
    content: z.string(),
  })
  .strict()

const CustomToolDocumentSchema = z
  .object({
    schemaText: z
      .string()
      .describe(
        'JSON text for an OpenAI function tool schema: {"type":"function","function":{"description":"What the tool does","parameters":{"type":"object","properties":{},"required":[]}}}. This field is a string containing JSON, not an object. Do not include a `name` property inside `function`; entityName is the canonical custom-tool name.'
      ),
    codeText: z
      .string()
      .describe(
        'Raw JavaScript async function body only. Do not include a function wrapper, export, markdown, or imports. Use <paramName> for parameters and {{ENV_VAR_NAME}} for environment variables.'
      ),
  })
  .strict()

const IndicatorDocumentSchema = z
  .object({
    color: z.string(),
    pineCode: z.string(),
  })
  .strict()

const McpServerDocumentSchema = z
  .object({
    description: z.string(),
    transport: z.enum(['http', 'sse', 'streamable-http']),
    url: z.string(),
    headers: z
      .record(z.string())
      .describe('MCP server headers shared with authorized workspace readers.'),
    command: z.string(),
    args: z.array(z.string()),
    env: z
      .record(z.string())
      .describe('MCP server environment variables shared with authorized workspace readers.'),
    timeout: z.number(),
    retries: z.number(),
    enabled: z.boolean(),
  })
  .strict()

const KnowledgeBaseDocumentSchema = z
  .object({
    description: z.string(),
    chunkingConfig: z
      .object({
        maxSize: z.number().min(100).max(4000),
        minSize: z.number().min(1).max(2000),
        overlap: z.number().min(0).max(500),
      })
      .refine((data) => data.minSize < data.maxSize, {
        message: 'minSize must be less than maxSize',
      }),
  })
  .strict()

const EntityDocumentSchemas = {
  skill: SkillDocumentSchema,
  custom_tool: CustomToolDocumentSchema,
  indicator: IndicatorDocumentSchema,
  mcp_server: McpServerDocumentSchema,
  knowledge_base: KnowledgeBaseDocumentSchema,
  watchlist: WatchlistContentDocumentSchema,
  dashboard_layout: DashboardLayoutDocumentContentSchema,
} as const

type EntityDocumentFields<K extends EntityDocumentKind> = z.infer<(typeof EntityDocumentSchemas)[K]>

const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      typeof item === 'string' ? item : String(item ?? ''),
    ])
  )
}

function normalizeHttpHeaderRecord(value: unknown): Record<string, string> {
  const entries = Object.entries(normalizeStringRecord(value))
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([key, item]) => key.length > 0 && item.length > 0)

  const invalidKey = entries.find(([key]) => !HTTP_HEADER_NAME_PATTERN.test(key))?.[0]
  if (invalidKey) {
    throw new Error(`Invalid MCP server header "${invalidKey}"`)
  }

  return Object.fromEntries(entries)
}

export function normalizeEntityFields(
  kind: EntityDocumentKind,
  fields: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const source = fields ?? {}

  switch (kind) {
    case 'skill':
      return {
        description: typeof source.description === 'string' ? source.description.trim() : '',
        content: typeof source.content === 'string' ? source.content.trim() : '',
      }
    case 'custom_tool': {
      const schemaText = typeof source.schemaText === 'string' ? source.schemaText : ''
      return {
        schemaText: JSON.stringify(parseCustomToolSchemaText(schemaText), null, 2),
        codeText: typeof source.codeText === 'string' ? source.codeText : '',
      }
    }
    case 'indicator': {
      return {
        color: typeof source.color === 'string' ? source.color.trim() : '',
        pineCode: typeof source.pineCode === 'string' ? source.pineCode : '',
      }
    }
    case 'mcp_server': {
      if (
        source.transport !== 'http' &&
        source.transport !== 'sse' &&
        source.transport !== 'streamable-http'
      ) {
        throw new Error(`Invalid MCP server transport "${String(source.transport ?? '')}"`)
      }

      const enabled = typeof source.enabled === 'boolean' ? source.enabled : true
      const rawUrl = typeof source.url === 'string' ? source.url.trim() : ''
      const validation = rawUrl ? validateMcpServerUrl(rawUrl) : null
      if (!rawUrl && enabled) {
        throw new Error('Invalid MCP server URL: URL is required and must be a string')
      }
      if (validation && !validation.isValid) {
        throw new Error(`Invalid MCP server URL: ${validation.error}`)
      }

      return {
        description: typeof source.description === 'string' ? source.description.trim() : '',
        transport: source.transport,
        url: validation?.normalizedUrl ?? rawUrl,
        headers: normalizeHttpHeaderRecord(source.headers),
        command: typeof source.command === 'string' ? source.command.trim() : '',
        args: Array.isArray(source.args)
          ? source.args.map((value) => (typeof value === 'string' ? value : String(value ?? '')))
          : [],
        env: normalizeStringRecord(source.env),
        timeout: typeof source.timeout === 'number' ? source.timeout : 30000,
        retries: typeof source.retries === 'number' ? source.retries : 3,
        enabled,
      }
    }
    case 'knowledge_base':
      return {
        description:
          typeof source.description === 'string' ? source.description.trim() : source.description,
        chunkingConfig: source.chunkingConfig,
      }
    case 'watchlist':
      return normalizeWatchlistDocumentContent(source)
    case 'dashboard_layout':
      return normalizeDashboardLayoutDocumentContent(source)
  }
}

export function getEntityDocumentFormat(kind: EntityDocumentKind): string {
  return ENTITY_DOCUMENT_FORMATS[kind]
}

export function getEntityDocumentSchema<K extends EntityDocumentKind>(kind: K) {
  return EntityDocumentSchemas[kind]
}

export function parseEntityDocument<K extends EntityDocumentKind>(
  kind: K,
  entityDocument: string
): EntityDocumentFields<K> {
  const raw = JSON.parse(entityDocument)
  if (kind === 'dashboard_layout') {
    return normalizeDashboardLayoutDocumentContent(raw) as EntityDocumentFields<K>
  }
  const parsedJson = EntityDocumentSchemas[kind].parse(raw)
  const normalized = normalizeEntityFields(kind, parsedJson)
  return EntityDocumentSchemas[kind].parse(normalized) as EntityDocumentFields<K>
}

function normalizeEntityDocumentFields<K extends EntityDocumentKind>(
  kind: K,
  fields: Record<string, unknown> | null | undefined
): EntityDocumentFields<K> {
  const normalized = normalizeEntityFields(kind, fields)
  return EntityDocumentSchemas[kind].parse(normalized) as EntityDocumentFields<K>
}

export function serializeEntityDocument<K extends EntityDocumentKind>(
  kind: K,
  fields: Record<string, unknown> | null | undefined
): string {
  return JSON.stringify(normalizeEntityDocumentFields(kind, fields), null, 2)
}
