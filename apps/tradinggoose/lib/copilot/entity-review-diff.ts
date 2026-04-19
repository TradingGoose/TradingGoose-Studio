import type { CopilotToolCall } from '@/stores/copilot/types'
import { parseEntityDocument } from '@/lib/copilot/entity-documents'

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

function buildSkillDocumentNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord | null {
  try {
    return {
      ...currentFields,
      ...parseEntityDocument('skill', String(toolCall.params?.entityDocument ?? '')),
    }
  } catch {
    return null
  }
}

function buildCustomToolDocumentNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord | null {
  try {
    return {
      ...currentFields,
      ...parseEntityDocument('custom_tool', String(toolCall.params?.entityDocument ?? '')),
    }
  } catch {
    return null
  }
}

function buildIndicatorDocumentNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord | null {
  try {
    return {
      ...currentFields,
      ...parseEntityDocument('indicator', String(toolCall.params?.entityDocument ?? '')),
    }
  } catch {
    return null
  }
}

function buildMcpDocumentNextFields(
  toolCall: CopilotToolCall,
  currentFields: EntityFieldRecord
): EntityFieldRecord | null {
  try {
    return {
      ...currentFields,
      ...parseEntityDocument('mcp_server', String(toolCall.params?.entityDocument ?? '')),
    }
  } catch {
    return null
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

  switch (toolCall.name) {
    case 'create_skill':
    case 'edit_skill':
    case 'rename_skill': {
      const nextFields = buildSkillDocumentNextFields(toolCall, currentFields)
      if (!nextFields) {
        return null
      }

      const sections = buildDiffSections(currentFields, nextFields, [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'content', label: 'Instructions' },
      ])
      return sections.length > 0 ? { title: 'Proposed Skill Changes', sections } : null
    }
    case 'create_custom_tool':
    case 'edit_custom_tool':
    case 'rename_custom_tool': {
      const nextFields = buildCustomToolDocumentNextFields(toolCall, currentFields)
      if (!nextFields) {
        return null
      }

      const sections = buildDiffSections(currentFields, nextFields, [
        { key: 'title', label: 'Title' },
        { key: 'schemaText', label: 'Schema' },
        { key: 'codeText', label: 'Code' },
      ])
      return sections.length > 0 ? { title: 'Proposed Custom Tool Changes', sections } : null
    }
    case 'create_indicator':
    case 'edit_indicator':
    case 'rename_indicator': {
      const nextFields = buildIndicatorDocumentNextFields(toolCall, currentFields)
      if (!nextFields) {
        return null
      }

      const sections = buildDiffSections(currentFields, nextFields, [
        { key: 'name', label: 'Name' },
        { key: 'color', label: 'Color' },
        { key: 'pineCode', label: 'Pine Code' },
        { key: 'inputMeta', label: 'Input Meta' },
      ])
      return sections.length > 0 ? { title: 'Proposed Indicator Changes', sections } : null
    }
    case 'create_mcp_server':
    case 'edit_mcp_server':
    case 'rename_mcp_server': {
      const nextFields = buildMcpDocumentNextFields(toolCall, currentFields)
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

export function buildEntityReviewDiffLines(before: string, after: string): EntityReviewDiffLine[] {
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
