import { z } from 'zod'

export const SKILL_DOCUMENT_FORMAT = 'tg-skill-document-v1' as const
export const CUSTOM_TOOL_DOCUMENT_FORMAT = 'tg-custom-tool-document-v1' as const
export const INDICATOR_DOCUMENT_FORMAT = 'tg-indicator-document-v1' as const
export const MCP_SERVER_DOCUMENT_FORMAT = 'tg-mcp-server-document-v1' as const

export const ENTITY_DOCUMENT_FORMATS = {
  skill: SKILL_DOCUMENT_FORMAT,
  custom_tool: CUSTOM_TOOL_DOCUMENT_FORMAT,
  indicator: INDICATOR_DOCUMENT_FORMAT,
  mcp_server: MCP_SERVER_DOCUMENT_FORMAT,
} as const

export type EntityDocumentKind = keyof typeof ENTITY_DOCUMENT_FORMATS

const SkillDocumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  content: z.string(),
})

const CustomToolDocumentSchema = z.object({
  title: z.string(),
  schemaText: z.string(),
  codeText: z.string(),
})

const IndicatorDocumentSchema = z.object({
  name: z.string(),
  color: z.string(),
  pineCode: z.string(),
  inputMeta: z.record(z.unknown()).nullable(),
})

const McpServerDocumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  transport: z.enum(['http', 'sse', 'streamable-http']),
  url: z.string(),
  headers: z.record(z.string()),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string()),
  timeout: z.number(),
  retries: z.number(),
  enabled: z.boolean(),
})

const EntityDocumentSchemas = {
  skill: SkillDocumentSchema,
  custom_tool: CustomToolDocumentSchema,
  indicator: IndicatorDocumentSchema,
  mcp_server: McpServerDocumentSchema,
} as const

export type EntityDocumentFields<K extends EntityDocumentKind> = z.infer<
  (typeof EntityDocumentSchemas)[K]
>

function normalizeEntityFields(
  kind: EntityDocumentKind,
  fields: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const source = fields ?? {}

  switch (kind) {
    case 'skill':
      return {
        name: typeof source.name === 'string' ? source.name : '',
        description: typeof source.description === 'string' ? source.description : '',
        content: typeof source.content === 'string' ? source.content : '',
      }
    case 'custom_tool':
      return {
        title: typeof source.title === 'string' ? source.title : '',
        schemaText: typeof source.schemaText === 'string' ? source.schemaText : '',
        codeText: typeof source.codeText === 'string' ? source.codeText : '',
      }
    case 'indicator':
      return {
        name: typeof source.name === 'string' ? source.name : '',
        color: typeof source.color === 'string' ? source.color : '',
        pineCode: typeof source.pineCode === 'string' ? source.pineCode : '',
        inputMeta:
          source.inputMeta && typeof source.inputMeta === 'object' && !Array.isArray(source.inputMeta)
            ? (source.inputMeta as Record<string, unknown>)
            : null,
      }
    case 'mcp_server':
      return {
        name: typeof source.name === 'string' ? source.name : '',
        description: typeof source.description === 'string' ? source.description : '',
        transport:
          source.transport === 'http' || source.transport === 'sse' || source.transport === 'streamable-http'
            ? source.transport
            : 'http',
        url: typeof source.url === 'string' ? source.url : '',
        headers:
          source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers)
            ? Object.fromEntries(
                Object.entries(source.headers as Record<string, unknown>).map(([key, value]) => [
                  key,
                  typeof value === 'string' ? value : String(value ?? ''),
                ])
              )
            : {},
        command: typeof source.command === 'string' ? source.command : '',
        args: Array.isArray(source.args)
          ? source.args.map((value) => (typeof value === 'string' ? value : String(value ?? '')))
          : [],
        env:
          source.env && typeof source.env === 'object' && !Array.isArray(source.env)
            ? Object.fromEntries(
                Object.entries(source.env as Record<string, unknown>).map(([key, value]) => [
                  key,
                  typeof value === 'string' ? value : String(value ?? ''),
                ])
              )
            : {},
        timeout: typeof source.timeout === 'number' ? source.timeout : 30000,
        retries: typeof source.retries === 'number' ? source.retries : 3,
        enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
      }
  }
}

export function getEntityDocumentFormat(kind: EntityDocumentKind): string {
  return ENTITY_DOCUMENT_FORMATS[kind]
}

export function parseEntityDocument<K extends EntityDocumentKind>(
  kind: K,
  entityDocument: string
): EntityDocumentFields<K> {
  const parsedJson = JSON.parse(entityDocument)
  const normalized = normalizeEntityFields(kind, parsedJson)
  return EntityDocumentSchemas[kind].parse(normalized) as EntityDocumentFields<K>
}

export function serializeEntityDocument<K extends EntityDocumentKind>(
  kind: K,
  fields: Record<string, unknown> | null | undefined
): string {
  const normalized = normalizeEntityFields(kind, fields)
  const parsed = EntityDocumentSchemas[kind].parse(normalized)
  return JSON.stringify(parsed, null, 2)
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
  }
}
