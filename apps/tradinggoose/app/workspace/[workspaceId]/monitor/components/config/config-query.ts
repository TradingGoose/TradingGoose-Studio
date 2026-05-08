import type {
  ConfigMonitorFilter,
  ConfigMonitorFilterField,
  ConfigMonitorFilterOperator,
} from '../view/view-config'
import type { ConfigMonitorCard } from './config-card-model'
import {
  CONFIG_MONITOR_OUTCOMES,
  normalizeConfigFilterValue,
  normalizeConfigFilterValues,
} from './config-filter-values'

type ParsedConfigQuery = {
  filters: ConfigMonitorFilter[]
  invalidTokens: string[]
  textSearch: string
}

const CONFIG_FIELDS = new Set([
  'workflowTarget',
  'indicator',
  'listing',
  'provider',
  'interval',
  'status',
  'lastExecutionAt',
  'lastOutcome',
  'lastExecutionLogId',
])

const PRESENCE_FIELDS = new Set(['lastExecutionAt', 'lastOutcome', 'lastExecutionLogId'])
const VALUE_ONLY_FIELDS = new Set([
  'workflowTarget',
  'indicator',
  'listing',
  'provider',
  'interval',
  'status',
])

const compareStrings = (left: string, right: string) =>
  left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' })

const tokenize = (query: string) => {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let escaping = false

  for (const character of query) {
    if (escaping) {
      current += character
      escaping = false
      continue
    }

    if (character === '\\') {
      escaping = true
      current += character
      continue
    }

    if (character === '"') {
      inQuote = !inQuote
      current += character
      continue
    }

    if (/\s/.test(character) && !inQuote) {
      if (current.trim()) tokens.push(current.trim())
      current = ''
      continue
    }

    current += character
  }

  if (current.trim()) tokens.push(current.trim())
  return tokens
}

const splitValues = (rawValue: string) => {
  const values: string[] = []
  let current = ''
  let inQuote = false
  let escaping = false

  for (const character of rawValue) {
    if (escaping) {
      current += character
      escaping = false
      continue
    }

    if (character === '\\') {
      escaping = true
      current += character
      continue
    }

    if (character === '"') {
      inQuote = !inQuote
      current += character
      continue
    }

    if (character === ',' && !inQuote) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += character
  }

  values.push(current.trim())
  return values.map(unquoteValue).filter(Boolean)
}

const unquoteValue = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return trimmed
}

const quoteValue = (value: string) => {
  if (!/[\s,":{}[\]/\\]/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const filterKey = (filter: ConfigMonitorFilter) => `${filter.field}:${filter.operator}`

const mergeFilters = (filters: ConfigMonitorFilter[]) => {
  const map = new Map<string, ConfigMonitorFilter>()

  filters.forEach((filter) => {
    const key = filterKey(filter)
    const current = map.get(key)
    if (!current) {
      map.set(key, filter)
      return
    }

    if (filter.operator === 'has' || filter.operator === 'no') {
      return
    }

    map.set(key, {
      ...current,
      values: Array.from(new Set(current.values.concat(filter.values))).sort(compareStrings),
    })
  })

  return Array.from(map.values()).sort((left, right) => {
    const fieldComparison = compareStrings(left.field, right.field)
    if (fieldComparison !== 0) return fieldComparison
    return compareStrings(left.operator, right.operator)
  })
}

const parseToken = (token: string): ConfigMonitorFilter | null => {
  const separatorIndex = token.indexOf(':')
  if (separatorIndex <= 0) return null

  const rawField = token.slice(0, separatorIndex)
  const rawValue = token.slice(separatorIndex + 1)

  if (rawField === 'has' || rawField === 'no') {
    const field = rawValue.trim()
    if (!PRESENCE_FIELDS.has(field)) return null
    return {
      field: field as ConfigMonitorFilterField,
      operator: rawField as ConfigMonitorFilterOperator,
      values: [],
    }
  }

  const operator: ConfigMonitorFilterOperator = rawField.startsWith('-') ? '!=' : '='
  const field = rawField.startsWith('-') ? rawField.slice(1) : rawField
  if (!CONFIG_FIELDS.has(field) || (!VALUE_ONLY_FIELDS.has(field) && field !== 'lastOutcome')) {
    return null
  }

  if (rawValue.trim().startsWith('!')) {
    return null
  }

  const values = normalizeConfigFilterValues(field, splitValues(rawValue))
  if (values.length === 0) return null

  return {
    field: field as ConfigMonitorFilterField,
    operator,
    values,
  }
}

export const parseConfigQuery = (query: string): ParsedConfigQuery => {
  const filters: ConfigMonitorFilter[] = []
  const invalidTokens: string[] = []
  const textTokens: string[] = []

  tokenize(query).forEach((token) => {
    if (token.includes(':')) {
      const parsed = parseToken(token)
      if (parsed) {
        filters.push(parsed)
      } else {
        invalidTokens.push(token)
      }
      return
    }
    textTokens.push(unquoteValue(token))
  })

  return {
    filters: mergeFilters(filters),
    invalidTokens,
    textSearch: textTokens.join(' ').trim(),
  }
}

export const serializeConfigFilters = (filters: ConfigMonitorFilter[]) =>
  mergeFilters(filters)
    .map((filter) => {
      if (filter.operator === 'has' || filter.operator === 'no') {
        return `${filter.operator}:${filter.field}`
      }

      const prefix = filter.operator === '!=' ? '-' : ''
      return `${prefix}${filter.field}:${filter.values.map(quoteValue).join(',')}`
    })
    .join(' ')

const getCardFieldValue = (card: ConfigMonitorCard, field: ConfigMonitorFilterField) => {
  switch (field) {
    case 'workflowTarget':
      return card.workflowTargetKey
    case 'indicator':
      return card.indicatorId
    case 'listing':
      return card.listingValue
    case 'provider':
      return card.providerId
    case 'interval':
      return card.interval
    case 'status':
      return card.status
    case 'lastExecutionAt':
      return card.lastExecutionAt
    case 'lastOutcome':
      return card.lastOutcome
    case 'lastExecutionLogId':
      return card.lastExecutionLogId
  }
}

const cardMatchesConfigFilter = (card: ConfigMonitorCard, filter: ConfigMonitorFilter) => {
  const value = getCardFieldValue(card, filter.field)

  if (filter.operator === 'has') return value !== null && value !== ''
  if (filter.operator === 'no') return value === null || value === ''

  if (value === null || value === '') return false
  const normalized = normalizeConfigFilterValue(filter.field, value)
  if (!normalized) return false

  const hasValue = filter.values.includes(normalized)
  return filter.operator === '=' ? hasValue : !hasValue
}

export const cardMatchesConfigFilters = (
  card: ConfigMonitorCard,
  filters: ConfigMonitorFilter[],
  textSearch: string
) => {
  if (!filters.every((filter) => cardMatchesConfigFilter(card, filter))) {
    return false
  }

  const text = textSearch.trim().toLowerCase()
  if (!text) return true

  return [
    card.monitorId,
    card.workflowTargetLabel,
    card.indicatorName,
    card.listingLabel,
    card.providerLabel,
    card.interval,
    card.status,
    card.lastOutcome ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(text)
}

export const getConfigOutcomeValues = () => [...CONFIG_MONITOR_OUTCOMES]
