import { getListingIdentitySymbol, toListingValueObject } from '@/lib/listing/identity'
import { getTriggerAwareSubBlockStableKey } from '@/lib/workflows/sub-block-keys'
import { resolveDisplayedSubBlockValue } from '@/lib/workflows/subblock-values'
import type { SubBlockConfig } from '@/blocks/types'
import { formatWorkflowTemplate } from '@/i18n/workflow-inspector-core'

export interface PreviewSummaryConditionRow {
  id: string
  title: string
  value: string
}

export interface PreviewJsonFieldRow {
  title: string
  value: string
}

export interface PreviewSummaryTextRow {
  id: string
  kind: 'text'
  title: string
  value: string
}

export interface PreviewSummaryListingRow {
  id: string
  kind: 'listing'
  title: string
  value: string
  rawValue: unknown
}

export interface PreviewSummaryJsonRow {
  id: string
  kind: 'json'
  title: string
  rows: PreviewJsonFieldRow[]
}

export type PreviewSummaryRowData =
  | PreviewSummaryTextRow
  | PreviewSummaryListingRow
  | PreviewSummaryJsonRow

export interface PreviewSummaryLabels {
  configured: string
  error: string
  fields: string
  items: string
  object: string
  value: string
}

interface BuildPreviewSummaryRowsParams {
  blockId: string
  subBlocks: SubBlockConfig[]
  stateToUse: Record<string, any>
  conditionRows?: PreviewSummaryConditionRow[]
  showErrorRow?: boolean
  availableTriggerIds?: string[]
  labels: PreviewSummaryLabels
  objectItemLabel: string
  additionalCountTemplate: string
  blockType?: string
  resolveDisplayValue: (
    config: Pick<SubBlockConfig, 'id' | 'options'>,
    value: unknown,
    blockType?: string
  ) => unknown
}

const EMPTY_VALUE_LABEL = '-'
const JSON_PREVIEW_ROW_LIMIT = 8

function readSubBlockStateValue(entry: unknown): unknown {
  if (entry && typeof entry === 'object' && 'value' in entry) {
    return (entry as { value: unknown }).value
  }

  return entry
}

function formatSummaryOverflow(template: string, count: number): string {
  return formatWorkflowTemplate(template, { count })
}

export function formatSubBlockSummaryValue(value: unknown, objectItemLabel: string): string {
  if (value === null || value === undefined || value === '') {
    return EMPTY_VALUE_LABEL
  }

  const getItemDisplayValue = (item: unknown): string => {
    if (item === null || item === undefined || item === '') {
      return ''
    }

    if (typeof item === 'object' && !Array.isArray(item)) {
      const objectItem = item as Record<string, unknown>
      return String(
        objectItem.title || objectItem.name || objectItem.label || objectItem.id || objectItemLabel
      )
    }

    return String(item)
  }

  if (Array.isArray(value)) {
    const nonEmptyItems = value.filter((item) => item !== null && item !== undefined && item !== '')
    if (nonEmptyItems.length === 0) {
      return EMPTY_VALUE_LABEL
    }

    if (nonEmptyItems.length === 1) {
      return getItemDisplayValue(nonEmptyItems[0])
    }

    if (nonEmptyItems.length === 2) {
      return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])}`
    }

    return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])} +${nonEmptyItems.length - 2}`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(
      ([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== ''
    )

    if (entries.length === 0) {
      return EMPTY_VALUE_LABEL
    }

    if (entries.length === 1) {
      const [entryKey, entryValue] = entries[0]
      const entryValueString = String(entryValue)
      const preview =
        entryValueString.length > 30 ? `${entryValueString.slice(0, 30)}...` : entryValueString
      return `${entryKey}: ${preview}`
    }

    const previewKeys = entries
      .slice(0, 2)
      .map(([entryKey]) => entryKey)
      .join(', ')

    return entries.length > 2 ? `${previewKeys} +${entries.length - 2}` : previewKeys
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    const serialized = JSON.stringify(value)
    return serialized === '{}' || serialized === '[]' ? EMPTY_VALUE_LABEL : serialized
  } catch {
    return String(value)
  }
}

function parseJsonDetailValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

export function buildJsonPreviewFieldRows({
  value,
  labels,
  objectItemLabel,
  additionalCountTemplate,
}: {
  value: unknown
  labels: Pick<PreviewSummaryLabels, 'fields' | 'items' | 'object' | 'value'>
  objectItemLabel: string
  additionalCountTemplate: string
}): PreviewJsonFieldRow[] {
  const parsedValue = parseJsonDetailValue(value)

  if (parsedValue === null || parsedValue === undefined || parsedValue === '') {
    return [{ title: labels.value, value: EMPTY_VALUE_LABEL }]
  }

  if (Array.isArray(parsedValue)) {
    if (parsedValue.length === 0) {
      return [{ title: labels.items, value: '0' }]
    }

    const firstItem = parsedValue[0]
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const entries = Object.entries(firstItem)
      const rows = entries.slice(0, JSON_PREVIEW_ROW_LIMIT).map(([key, entryValue]) => ({
        title: key,
        value: formatSubBlockSummaryValue(entryValue, objectItemLabel),
      }))

      if (entries.length > JSON_PREVIEW_ROW_LIMIT) {
        rows.push({
          title: labels.fields,
          value: formatSummaryOverflow(
            additionalCountTemplate,
            entries.length - JSON_PREVIEW_ROW_LIMIT
          ),
        })
      }

      if (parsedValue.length > 1) {
        rows.push({
          title: labels.items,
          value: String(parsedValue.length),
        })
      }

      return rows
    }

    const rows = parsedValue.slice(0, JSON_PREVIEW_ROW_LIMIT).map((item, index) => ({
      title: `[${index}]`,
      value: formatSubBlockSummaryValue(item, objectItemLabel),
    }))

    if (parsedValue.length > JSON_PREVIEW_ROW_LIMIT) {
      rows.push({
        title: labels.items,
        value: formatSummaryOverflow(
          additionalCountTemplate,
          parsedValue.length - JSON_PREVIEW_ROW_LIMIT
        ),
      })
    }

    return rows
  }

  if (typeof parsedValue === 'object') {
    const entries = Object.entries(parsedValue)
    if (entries.length === 0) {
      return [{ title: labels.object, value: '{}' }]
    }

    const rows = entries.slice(0, JSON_PREVIEW_ROW_LIMIT).map(([key, entryValue]) => ({
      title: key,
      value: formatSubBlockSummaryValue(entryValue, objectItemLabel),
    }))

    if (entries.length > JSON_PREVIEW_ROW_LIMIT) {
      rows.push({
        title: labels.fields,
        value: formatSummaryOverflow(
          additionalCountTemplate,
          entries.length - JSON_PREVIEW_ROW_LIMIT
        ),
      })
    }

    return rows
  }

  return [
    {
      title: labels.value,
      value: formatSubBlockSummaryValue(parsedValue, objectItemLabel),
    },
  ]
}

export function formatSkillInputValue(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return EMPTY_VALUE_LABEL
  }

  const resolvedNames = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const storedSkill = item as { skillId?: string; name?: string }
      if (typeof storedSkill.name === 'string' && storedSkill.name.length > 0) {
        return storedSkill.name
      }

      return storedSkill.skillId ?? null
    })
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  if (resolvedNames.length === 0) {
    return EMPTY_VALUE_LABEL
  }

  if (resolvedNames.length === 1) {
    return resolvedNames[0]
  }

  if (resolvedNames.length === 2) {
    return `${resolvedNames[0]}, ${resolvedNames[1]}`
  }

  return `${resolvedNames[0]}, ${resolvedNames[1]} +${resolvedNames.length - 2}`
}

export function formatPreviewListingValue(value: unknown, objectItemLabel: string): string {
  const identity = toListingValueObject(value)

  if (!identity) {
    return formatSubBlockSummaryValue(value, objectItemLabel)
  }

  return getListingIdentitySymbol(identity)
}

export function buildPreviewSummaryRows({
  blockId,
  subBlocks,
  stateToUse,
  conditionRows,
  showErrorRow = false,
  availableTriggerIds,
  labels,
  objectItemLabel,
  additionalCountTemplate,
  blockType,
  resolveDisplayValue,
}: BuildPreviewSummaryRowsParams): PreviewSummaryRowData[] {
  const rows: PreviewSummaryRowData[] = []

  if (conditionRows) {
    rows.push(
      ...conditionRows.map((conditionRow) => ({
        id: conditionRow.id,
        kind: 'text' as const,
        title: conditionRow.title,
        value: formatSubBlockSummaryValue(conditionRow.value, objectItemLabel),
      }))
    )
  } else {
    rows.push(
      ...subBlocks.map((subBlock, index) => {
        const stableKey = `${getTriggerAwareSubBlockStableKey(
          blockId,
          subBlock,
          stateToUse,
          availableTriggerIds
        )}-${index}`
        const rawValue = resolveDisplayedSubBlockValue(
          {
            readOnly: subBlock.readOnly,
            defaultValue: subBlock.defaultValue,
          },
          readSubBlockStateValue(stateToUse[subBlock.id])
        )
        const localizedValue = resolveDisplayValue(
          { id: subBlock.id, options: subBlock.options },
          rawValue,
          blockType
        )
        const title = subBlock.title ?? subBlock.id

        if (subBlock.type === 'code' && subBlock.language === 'json') {
          return {
            id: stableKey,
            kind: 'json' as const,
            title,
            rows: buildJsonPreviewFieldRows({
              value: localizedValue,
              labels,
              objectItemLabel,
              additionalCountTemplate,
            }),
          }
        }

        if (!subBlock.password && subBlock.type === 'market-selector') {
          return {
            id: stableKey,
            kind: 'listing' as const,
            title,
            value: formatPreviewListingValue(rawValue, objectItemLabel),
            rawValue,
          }
        }

        const value = subBlock.password
          ? rawValue === null || rawValue === undefined || rawValue === ''
            ? EMPTY_VALUE_LABEL
            : labels.configured
          : subBlock.type === 'skill-input'
            ? formatSkillInputValue(localizedValue)
            : formatSubBlockSummaryValue(localizedValue, objectItemLabel)

        return {
          id: stableKey,
          kind: 'text' as const,
          title,
          value,
        }
      })
    )
  }

  if (showErrorRow) {
    rows.push({
      id: `${blockId}-error`,
      kind: 'text',
      title: labels.error,
      value: EMPTY_VALUE_LABEL,
    })
  }

  return rows
}
