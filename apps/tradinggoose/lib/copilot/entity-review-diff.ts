import type { CopilotToolCall } from '@/stores/copilot/types'

export interface EntityReviewDiffSection {
  key: string
  label: string
  before: string
  after: string
}

export interface EntityReviewDiffPayload {
  title: string
  sections: EntityReviewDiffSection[]
}

type EntityFieldRecord = Record<string, any>

type DiffFieldConfig = {
  key: string
  label: string
}

type CustomToolSchema = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

type McpServerConfig = {
  name?: string
  description?: string | null
  transport?: 'http' | 'sse' | 'streamable-http'
  url?: string
  headers?: Record<string, string>
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
}

const DIFF_CONTEXT_LINES = 2

function stringifyDiffValue(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatCustomToolSchema(schema: CustomToolSchema): string {
  return JSON.stringify(schema, null, 2)
}

function renameSchemaFunction(schemaText: string, title: string): string {
  try {
    const parsed = JSON.parse(schemaText) as CustomToolSchema
    parsed.function.name = title
    return formatCustomToolSchema(parsed)
  } catch {
    return schemaText
  }
}

function buildDiffSections(
  currentFields: EntityFieldRecord,
  nextFields: EntityFieldRecord,
  fields: DiffFieldConfig[]
): EntityReviewDiffSection[] {
  const sections: EntityReviewDiffSection[] = []

  for (const field of fields) {
    const before = stringifyDiffValue(currentFields[field.key])
    const after = stringifyDiffValue(nextFields[field.key])

    if (before === after) {
      continue
    }

    sections.push({
      key: field.key,
      label: field.label,
      before,
      after,
    })
  }

  return sections
}

function buildSkillNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord {
  const params = toolCall.params || {}

  return {
    ...currentFields,
    ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.description !== undefined ? { description: params.description } : {}),
    ...(params.content !== undefined ? { content: params.content } : {}),
  }
}

function buildCustomToolNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord {
  const params = toolCall.params || {}
  const nextTitle = params.title ?? params.schema?.function?.name ?? currentFields.title ?? ''
  const nextSchemaText = params.schema
    ? formatCustomToolSchema(params.schema as CustomToolSchema)
    : params.title !== undefined
      ? renameSchemaFunction(currentFields.schemaText ?? '', params.title)
      : currentFields.schemaText ?? ''

  return {
    ...currentFields,
    ...(params.title !== undefined || params.schema !== undefined ? { title: nextTitle } : {}),
    ...(params.title !== undefined || params.schema !== undefined
      ? { schemaText: nextSchemaText }
      : {}),
    ...(params.code !== undefined ? { codeText: params.code } : {}),
  }
}

function buildIndicatorNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord {
  const params = toolCall.params || {}

  return {
    ...currentFields,
    ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.color !== undefined ? { color: params.color } : {}),
    ...(params.pineCode !== undefined ? { pineCode: params.pineCode } : {}),
    ...(params.inputMeta !== undefined ? { inputMeta: params.inputMeta } : {}),
  }
}

function buildMcpNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord | null {
  const params = toolCall.params || {}
  const config =
    params.config && typeof params.config === 'object'
      ? (params.config as McpServerConfig)
      : null

  if (!config) {
    return null
  }

  if (params.operation === 'add') {
    return {
      ...currentFields,
      name: config.name ?? currentFields.name,
      description: config.description ?? '',
      transport: config.transport ?? 'streamable-http',
      url: config.url ?? '',
      headers: config.headers ?? {},
      command: config.command ?? '',
      args: config.args ?? [],
      env: config.env ?? {},
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
      enabled: config.enabled ?? true,
    }
  }

  return {
    ...currentFields,
    ...(config.name !== undefined ? { name: config.name } : {}),
    ...(config.description !== undefined ? { description: config.description ?? '' } : {}),
    ...(config.transport !== undefined ? { transport: config.transport } : {}),
    ...(config.url !== undefined ? { url: config.url } : {}),
    ...(config.headers !== undefined ? { headers: config.headers } : {}),
    ...(config.command !== undefined ? { command: config.command ?? '' } : {}),
    ...(config.args !== undefined ? { args: config.args } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
    ...(config.retries !== undefined ? { retries: config.retries } : {}),
    ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
  }
}

function splitDiffLines(value: string): string[] {
  return value === '' ? [] : value.split('\n')
}

export function buildEntityReviewDiffPayload(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord | null | undefined
): EntityReviewDiffPayload | null {
  if (toolCall.state !== 'pending' || !currentFields) {
    return null
  }

  const operation = toolCall.params?.operation
  if (operation !== 'add' && operation !== 'edit') {
    return null
  }

  switch (toolCall.name) {
    case 'manage_skill': {
      const sections = buildDiffSections(currentFields, buildSkillNextFields(toolCall, currentFields), [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'content', label: 'Instructions' },
      ])
      return sections.length > 0 ? { title: 'Proposed Skill Changes', sections } : null
    }
    case 'manage_custom_tool': {
      const sections = buildDiffSections(
        currentFields,
        buildCustomToolNextFields(toolCall, currentFields),
        [
          { key: 'title', label: 'Title' },
          { key: 'schemaText', label: 'Schema' },
          { key: 'codeText', label: 'Code' },
        ]
      )
      return sections.length > 0 ? { title: 'Proposed Custom Tool Changes', sections } : null
    }
    case 'manage_indicator': {
      const sections = buildDiffSections(
        currentFields,
        buildIndicatorNextFields(toolCall, currentFields),
        [
          { key: 'name', label: 'Name' },
          { key: 'color', label: 'Color' },
          { key: 'pineCode', label: 'Pine Code' },
          { key: 'inputMeta', label: 'Input Meta' },
        ]
      )
      return sections.length > 0 ? { title: 'Proposed Indicator Changes', sections } : null
    }
    case 'manage_mcp_tool': {
      const nextFields = buildMcpNextFields(toolCall, currentFields)
      if (!nextFields) {
        return null
      }

      const sections = buildDiffSections(currentFields, nextFields, [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'transport', label: 'Transport' },
        { key: 'url', label: 'URL' },
        { key: 'headers', label: 'Headers' },
        { key: 'command', label: 'Command' },
        { key: 'args', label: 'Args' },
        { key: 'env', label: 'Environment' },
        { key: 'timeout', label: 'Timeout' },
        { key: 'retries', label: 'Retries' },
        { key: 'enabled', label: 'Enabled' },
      ])
      return sections.length > 0 ? { title: 'Proposed MCP Server Changes', sections } : null
    }
    default:
      return null
  }
}

export type EntityReviewDiffLine =
  | { type: 'context'; text: string }
  | { type: 'removed'; text: string }
  | { type: 'added'; text: string }

export function buildEntityReviewDiffLines(
  before: string,
  after: string
): EntityReviewDiffLine[] {
  const beforeLines = splitDiffLines(before)
  const afterLines = splitDiffLines(after)

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const lines: EntityReviewDiffLine[] = []

  for (const line of beforeLines.slice(0, prefix).slice(-DIFF_CONTEXT_LINES)) {
    lines.push({ type: 'context', text: line })
  }

  for (const line of beforeLines.slice(prefix, beforeLines.length - suffix)) {
    lines.push({ type: 'removed', text: line })
  }

  for (const line of afterLines.slice(prefix, afterLines.length - suffix)) {
    lines.push({ type: 'added', text: line })
  }

  for (const line of afterLines.slice(afterLines.length - suffix).slice(0, DIFF_CONTEXT_LINES)) {
    lines.push({ type: 'context', text: line })
  }

  return lines
}
