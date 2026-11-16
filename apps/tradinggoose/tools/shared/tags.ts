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
