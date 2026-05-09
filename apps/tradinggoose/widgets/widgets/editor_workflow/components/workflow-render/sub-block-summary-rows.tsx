import { cn } from '@/lib/utils'
import { getTriggerAwareSubBlockStableKey } from '@/lib/workflows/sub-block-keys'
import { resolveDisplayedSubBlockValue } from '@/lib/workflows/subblock-values'
import type { SubBlockConfig } from '@/blocks/types'

export interface SubBlockSummaryConditionRow {
  id: string
  title: string
  value: string
}

interface SubBlockSummaryRowsProps {
  blockId: string
  subBlocks: SubBlockConfig[]
  stateToUse: Record<string, any>
  conditionRows?: SubBlockSummaryConditionRow[]
  showErrorRow?: boolean
  availableTriggerIds?: string[]
  labelClassName?: string
  valueClassName?: string
}

interface JsonPreviewFieldRow {
  title: string
  value: string
}

const EMPTY_VALUE_LABEL = '-'
const CONFIGURED_VALUE_LABEL = 'Configured'
const ERROR_ROW_LABEL = 'error'
const JSON_PREVIEW_ROW_LIMIT = 8

function readSubBlockStateValue(entry: unknown): unknown {
  if (entry && typeof entry === 'object' && 'value' in entry) {
    return (entry as { value: unknown }).value
  }
  return entry
}

function formatSubBlockSummaryValue(value: unknown): string {
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
        objectItem.title || objectItem.name || objectItem.label || objectItem.id || '[Object]'
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

function buildJsonPreviewFieldRows(value: unknown): JsonPreviewFieldRow[] {
  const parsedValue = parseJsonDetailValue(value)

  if (parsedValue === null || parsedValue === undefined || parsedValue === '') {
    return [{ title: 'value', value: EMPTY_VALUE_LABEL }]
  }

  if (Array.isArray(parsedValue)) {
    if (parsedValue.length === 0) {
      return [{ title: 'items', value: '0' }]
    }

    const firstItem = parsedValue[0]
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const entries = Object.entries(firstItem)
      const rows = entries.slice(0, JSON_PREVIEW_ROW_LIMIT).map(([key, entryValue]) => ({
        title: key,
        value: formatSubBlockSummaryValue(entryValue),
      }))

      if (entries.length > JSON_PREVIEW_ROW_LIMIT) {
        rows.push({
          title: 'fields',
          value: `+${entries.length - JSON_PREVIEW_ROW_LIMIT} more`,
        })
      }

      if (parsedValue.length > 1) {
        rows.push({
          title: 'items',
          value: String(parsedValue.length),
        })
      }

      return rows
    }

    const rows = parsedValue
      .slice(0, JSON_PREVIEW_ROW_LIMIT)
      .map((item, index) => ({ title: `[${index}]`, value: formatSubBlockSummaryValue(item) }))

    if (parsedValue.length > JSON_PREVIEW_ROW_LIMIT) {
      rows.push({
        title: 'items',
        value: `+${parsedValue.length - JSON_PREVIEW_ROW_LIMIT} more`,
      })
    }

    return rows
  }

  if (typeof parsedValue === 'object') {
    const entries = Object.entries(parsedValue)
    if (entries.length === 0) {
      return [{ title: 'object', value: '{}' }]
    }

    const rows = entries.slice(0, JSON_PREVIEW_ROW_LIMIT).map(([key, entryValue]) => ({
      title: key,
      value: formatSubBlockSummaryValue(entryValue),
    }))

    if (entries.length > JSON_PREVIEW_ROW_LIMIT) {
      rows.push({
        title: 'fields',
        value: `+${entries.length - JSON_PREVIEW_ROW_LIMIT} more`,
      })
    }

    return rows
  }

  return [{ title: 'value', value: formatSubBlockSummaryValue(parsedValue) }]
}

function formatSkillInputValue(value: unknown): string {
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

function SummaryRow({
  title,
  value,
  labelClassName,
  valueClassName,
}: {
  title: string
  value: string
  labelClassName?: string
  valueClassName?: string
}) {
  return (
    <div className='flex items-center gap-2'>
      <p
        className={cn('min-w-0 truncate text-muted-foreground capitalize', labelClassName)}
        title={title}
      >
        {title}
      </p>
      <p className={cn('min-w-0 flex-1 truncate text-right', valueClassName)} title={value}>
        {value}
      </p>
    </div>
  )
}

export function SubBlockSummaryRows({
  blockId,
  subBlocks,
  stateToUse,
  conditionRows,
  showErrorRow = false,
  availableTriggerIds,
  labelClassName,
  valueClassName,
}: SubBlockSummaryRowsProps) {
  return (
    <>
      {conditionRows
        ? conditionRows.map((conditionRow) => (
            <SummaryRow
              key={conditionRow.id}
              title={conditionRow.title}
              value={formatSubBlockSummaryValue(conditionRow.value)}
              labelClassName={labelClassName}
              valueClassName={valueClassName}
            />
          ))
        : subBlocks.map((subBlock, index) => {
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
            const isJsonCodeSubBlock = subBlock.type === 'code' && subBlock.language === 'json'
            const displayValue = subBlock.password
              ? rawValue === null || rawValue === undefined || rawValue === ''
                ? EMPTY_VALUE_LABEL
                : CONFIGURED_VALUE_LABEL
              : subBlock.type === 'skill-input'
                ? formatSkillInputValue(rawValue)
                : formatSubBlockSummaryValue(rawValue)
            const title = subBlock.title ?? subBlock.id

            if (isJsonCodeSubBlock) {
              return (
                <div key={stableKey} className='flex flex-col gap-1'>
                  <p
                    className={cn(
                      'min-w-0 truncate text-muted-foreground capitalize',
                      labelClassName
                    )}
                    title={title}
                  >
                    {title}:
                  </p>
                  <div className='ml-3 overflow-hidden rounded-md border border-border bg-background'>
                    {buildJsonPreviewFieldRows(rawValue).map((jsonRow, jsonRowIndex) => (
                      <div
                        key={`${stableKey}-json-row-${jsonRowIndex}`}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5',
                          jsonRowIndex > 0 && 'border-border border-t'
                        )}
                      >
                        <p
                          className={cn('min-w-0 truncate text-muted-foreground', labelClassName)}
                          title={jsonRow.title}
                        >
                          {jsonRow.title}
                        </p>
                        <p
                          className={cn('min-w-0 flex-1 truncate text-right', valueClassName)}
                          title={jsonRow.value}
                        >
                          {jsonRow.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }

            return (
              <SummaryRow
                key={stableKey}
                title={title}
                value={displayValue}
                labelClassName={labelClassName}
                valueClassName={valueClassName}
              />
            )
          })}
      {showErrorRow && (
        <SummaryRow
          title={ERROR_ROW_LABEL}
          value={EMPTY_VALUE_LABEL}
          labelClassName={labelClassName}
          valueClassName={valueClassName}
        />
      )}
    </>
  )
}
