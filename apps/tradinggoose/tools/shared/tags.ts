/**
 * Document tag entry format used in create_document tool.
 */
export interface DocumentTagEntry {
  tagName: string
  value: string
}

/**
 * Checks if a tag value is effectively empty (unfilled/default entry).
 */
function isEmptyTagEntry(entry: Record<string, unknown>): boolean {
  if (!entry.tagName || (typeof entry.tagName === 'string' && entry.tagName.trim() === '')) {
    return true
  }
  return false
}

/**
 * Checks if a tag-based value is effectively empty (only contains default/unfilled entries).
 */
export function isEmptyTagValue(value: unknown): boolean {
  if (!value) return true

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) return false
      if (parsed.length === 0) return true
      return parsed.every((entry: Record<string, unknown>) => isEmptyTagEntry(entry))
    } catch {
      return false
    }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return true
    return value.every((entry: Record<string, unknown>) => isEmptyTagEntry(entry))
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) return true
    return entries.every(([, val]) => val === undefined || val === null || val === '')
  }

  return false
}

/**
 * Filters valid document tags from an array, removing empty entries.
 */
function filterValidDocumentTags(tags: unknown[]): DocumentTagEntry[] {
  return tags
    .filter((entry): entry is Record<string, unknown> => {
      if (typeof entry !== 'object' || entry === null) return false
      const e = entry as Record<string, unknown>
      if (!e.tagName || (typeof e.tagName === 'string' && e.tagName.trim() === '')) return false
      if (e.value === undefined || e.value === null || e.value === '') return false
      return true
    })
    .map((entry) => ({
      tagName: String(entry.tagName),
      value: String(entry.value),
    }))
}

/**
 * Parses document tags from various formats into a normalized array format.
 */
export function parseDocumentTags(value: unknown): DocumentTagEntry[] {
  if (!value) return []

  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    return Object.entries(value)
      .filter(([tagName, tagValue]) => {
        if (!tagName || tagName.trim() === '') return false
        if (tagValue === undefined || tagValue === null || tagValue === '') return false
        return true
      })
      .map(([tagName, tagValue]) => ({
        tagName,
        value: String(tagValue),
      }))
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return filterValidDocumentTags(parsed)
      }
    } catch {
      return []
    }
    return []
  }

  if (Array.isArray(value)) {
    return filterValidDocumentTags(value)
  }

  return []
}

/** Convert editor/LLM tag rows to the search API's text-equality filter map. */
export function parseTagFilters(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {}
  let rows = value
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows)
    } catch {
      throw new Error('Tag filters must be a valid JSON array')
    }
  }
  if (!Array.isArray(rows)) throw new Error('Tag filters must be an array')

  const filters: Record<string, string> = Object.create(null)
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Each tag filter must contain tagName and tagValue')
    }
    const { tagName, tagValue, operator, fieldType } = row
    if ((!tagName || !String(tagName).trim()) && (tagValue == null || tagValue === '')) continue
    if (typeof tagName !== 'string' || !tagName.trim()) {
      throw new Error('Tag filter name is required')
    }
    if (
      (operator !== undefined && operator !== 'eq') ||
      (fieldType !== undefined && fieldType !== 'text')
    ) {
      throw new Error('Knowledge tag filters support text equality only')
    }
    if (
      !['string', 'number', 'boolean'].includes(typeof tagValue) ||
      (typeof tagValue === 'number' && !Number.isFinite(tagValue))
    ) {
      throw new Error('Tag filter values must be text, numbers, or booleans')
    }
    const text = String(tagValue).trim()
    if (!text || text.split('|OR|').some((part) => !part.trim())) {
      throw new Error('Tag filter value is required')
    }
    const name = tagName.trim()
    filters[name] = filters[name] ? `${filters[name]}|OR|${text}` : text
  }
  return filters
}

/**
 * Converts parsed document tags to the format expected by the create document API.
 */
export function formatDocumentTagsForAPI(tags: DocumentTagEntry[]): { documentTagsData?: string } {
  if (tags.length === 0) return {}
  return {
    documentTagsData: JSON.stringify(tags),
  }
}
