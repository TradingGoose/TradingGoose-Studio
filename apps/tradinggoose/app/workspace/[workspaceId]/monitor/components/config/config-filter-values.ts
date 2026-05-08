import { toListingValueObject } from '@/lib/listing/identity'

export const CONFIG_MONITOR_OUTCOMES = [
  'running',
  'success',
  'error',
  'skipped',
  'unknown',
] as const

const CONFIG_MONITOR_STATUSES = ['active', 'paused'] as const

const sortStrings = (values: string[]) =>
  [...values].sort((left, right) =>
    left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' })
  )

const normalizeListingFilterValue = (rawValue: string) => {
  try {
    const parsed = JSON.parse(rawValue)
    const normalized = toListingValueObject(parsed)
    return normalized ? JSON.stringify(normalized) : null
  } catch {
    return null
  }
}

export const normalizeConfigFilterValue = (field: string, rawValue: unknown): string | null => {
  if (typeof rawValue !== 'string') return null
  const trimmed = rawValue.trim()
  if (!trimmed) return null

  switch (field) {
    case 'workflowTarget':
      return trimmed.includes(':') ? trimmed : null
    case 'indicator':
    case 'provider':
    case 'interval':
      return trimmed
    case 'listing':
      return normalizeListingFilterValue(trimmed)
    case 'status': {
      const status = trimmed.toLowerCase()
      return CONFIG_MONITOR_STATUSES.includes(status as (typeof CONFIG_MONITOR_STATUSES)[number])
        ? status
        : null
    }
    case 'lastOutcome': {
      const outcome = trimmed.toLowerCase()
      return CONFIG_MONITOR_OUTCOMES.includes(outcome as (typeof CONFIG_MONITOR_OUTCOMES)[number])
        ? outcome
        : null
    }
    default:
      return null
  }
}

export const normalizeConfigFilterValues = (field: string, rawValues: unknown): string[] => {
  if (!Array.isArray(rawValues)) return []

  const values = new Set<string>()
  rawValues.forEach((rawValue) => {
    const normalized = normalizeConfigFilterValue(field, rawValue)
    if (normalized) {
      values.add(normalized)
    }
  })

  return sortStrings(Array.from(values))
}

export const canonicalizeListingValue = (value: unknown): string | null => {
  const normalized = toListingValueObject(value as any)
  return normalized ? JSON.stringify(normalized) : null
}
