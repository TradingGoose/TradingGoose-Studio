import { z } from 'zod'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
export const SKILL_DOCUMENT_FORMAT = 'tg-skill-document-v1' as const
export const CUSTOM_TOOL_DOCUMENT_FORMAT = 'tg-custom-tool-document-v1' as const
export const INDICATOR_DOCUMENT_FORMAT = 'tg-indicator-document-v1' as const
export const MCP_SERVER_DOCUMENT_FORMAT = 'tg-mcp-server-document-v1' as const
export const KNOWLEDGE_BASE_DOCUMENT_FORMAT = 'tg-knowledge-base-document-v1' as const
export const WORKFLOW_VARIABLE_DOCUMENT_FORMAT = 'tg-workflow-variable-document-v1' as const

export const ENTITY_DOCUMENT_FORMATS = {
  skill: SKILL_DOCUMENT_FORMAT,
  custom_tool: CUSTOM_TOOL_DOCUMENT_FORMAT,
  indicator: INDICATOR_DOCUMENT_FORMAT,
  mcp_server: MCP_SERVER_DOCUMENT_FORMAT,
  knowledge_base: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
} as const

export type EntityDocumentKind = keyof typeof ENTITY_DOCUMENT_FORMATS

const SkillDocumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  content: z.string(),
})

const CustomToolDocumentSchema = z.object({
  title: z.string().describe('Human-readable custom tool title.'),
  schemaText: z
    .string()
    .describe(
      'JSON text for an OpenAI function tool schema: {"type":"function","function":{"description":"What the tool does","parameters":{"type":"object","properties":{},"required":[]}}}. This field is a string containing JSON, not an object. Do not include a `name` property inside `function`; the document `title` is the canonical custom-tool name.'
    ),
  codeText: z
    .string()
    .describe(
      'Raw JavaScript async function body only. Do not include a function wrapper, export, markdown, or imports. Use <paramName> for parameters and {{ENV_VAR_NAME}} for environment variables.'
    ),
})

const IndicatorDocumentSchema = z.object({
  name: z.string(),
  color: z.string(),
  pineCode: z.string(),
})

const McpServerDocumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  transport: z.enum(['http', 'sse', 'streamable-http']),
  url: z.string(),
  headers: z
    .record(z.string())
    .describe(
      'MCP server headers. Secret values are returned as [redacted]; keep [redacted] to preserve an existing value, send a concrete value to replace it, or omit a key to delete it.'
    ),
  command: z.string(),
  args: z.array(z.string()),
  env: z
    .record(z.string())
    .describe(
      'MCP server environment variables. Secret values are returned as [redacted]; keep [redacted] to preserve an existing value, send a concrete value to replace it, or omit a key to delete it.'
    ),
  timeout: z.number(),
  retries: z.number(),
  enabled: z.boolean(),
})

const KnowledgeBaseDocumentSchema = z.object({
  name: z.string().trim().min(1),
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

export const EntityDocumentSchemas = {
  skill: SkillDocumentSchema,
  custom_tool: CustomToolDocumentSchema,
  indicator: IndicatorDocumentSchema,
  mcp_server: McpServerDocumentSchema,
  knowledge_base: KnowledgeBaseDocumentSchema,
} as const

export type EntityDocumentFields<K extends EntityDocumentKind> = z.infer<
  (typeof EntityDocumentSchemas)[K]
>

export const ENTITY_SECRET_PLACEHOLDER = '[redacted]'
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function redactStringRecordValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>).map((key) => [key, ENTITY_SECRET_PLACEHOLDER])
  )
}

export function normalizeStringRecord(value: unknown): Record<string, string> {
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
        name: typeof source.name === 'string' ? source.name.trim() : '',
        description: typeof source.description === 'string' ? source.description.trim() : '',
        content: typeof source.content === 'string' ? source.content.trim() : '',
      }
    case 'custom_tool': {
      const schemaText = typeof source.schemaText === 'string' ? source.schemaText : ''
      return {
        title: typeof source.title === 'string' ? source.title.trim().replace(/\s+/g, ' ') : '',
        schemaText: JSON.stringify(parseCustomToolSchemaText(schemaText), null, 2),
        codeText: typeof source.codeText === 'string' ? source.codeText : '',
      }
    }
    case 'indicator': {
      const pineCode = typeof source.pineCode === 'string' ? source.pineCode : ''
      return {
        name: typeof source.name === 'string' ? source.name.trim() : '',
        color: typeof source.color === 'string' ? source.color.trim() : '',
        pineCode,
        inputMeta: inferInputMetaFromPineCode(pineCode) ?? null,
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
        name: typeof source.name === 'string' ? source.name.trim() : '',
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
        name: typeof source.name === 'string' ? source.name.trim() : source.name,
        description:
          typeof source.description === 'string' ? source.description.trim() : source.description,
        chunkingConfig: source.chunkingConfig,
      }
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
  const parsedJson = JSON.parse(entityDocument)
  const normalized = normalizeEntityFields(kind, parsedJson)
  return EntityDocumentSchemas[kind].parse(normalized) as EntityDocumentFields<K>
}

function redactEntityDocumentSecretFields<K extends EntityDocumentKind>(
  kind: K,
  fields: Record<string, unknown> | null | undefined
): EntityDocumentFields<K> {
  const normalized = normalizeEntityFields(kind, fields)
  const redacted =
    kind === 'mcp_server'
      ? {
          ...normalized,
          headers: redactStringRecordValues(normalized.headers),
          env: redactStringRecordValues(normalized.env),
        }
      : normalized

  return EntityDocumentSchemas[kind].parse(redacted) as EntityDocumentFields<K>
}

export function serializeEntityDocument<K extends EntityDocumentKind>(
  kind: K,
  fields: Record<string, unknown> | null | undefined
): string {
  return JSON.stringify(redactEntityDocumentSecretFields(kind, fields), null, 2)
}

export function getEntityDocumentName(
  kind: EntityDocumentKind,
  fields: Record<string, unknown> | null | undefined
): string {
  const normalized = normalizeEntityFields(kind, fields)

  switch (kind) {
    case 'skill':
      return String(normalized.name ?? '')
    case 'custom_tool':
      return String(normalized.title ?? '')
    case 'indicator':
      return String(normalized.name ?? '')
    case 'mcp_server':
      return String(normalized.name ?? '')
    case 'knowledge_base':
      return String(normalized.name ?? '')
  }
}
