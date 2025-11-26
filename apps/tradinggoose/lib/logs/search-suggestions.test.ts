import { describe, expect, it } from 'vitest'
import { SearchSuggestions } from './search-suggestions'

const workflows = [
  { id: 'wf-1', name: 'Critical Alerts', description: 'High priority alerts' },
  { id: 'wf-2', name: 'Daily Sync', description: 'Nightly synchronization' },
]

const folders = [
  { id: 'folder-1', name: 'Shared' },
  { id: 'folder-2', name: 'Archived' },
]

describe('SearchSuggestions', () => {
  const engine = new SearchSuggestions(workflows, folders)

  it.concurrent('returns filter keys for empty input', () => {
    const result = engine.getSuggestions('')
    expect(result?.type).toBe('filter-keys')
    expect(result?.suggestions.find((s) => s.value === 'level:')).toBeTruthy()
    expect(result?.suggestions.find((s) => s.value === 'workflow:')).toBeTruthy()
    expect(result?.suggestions.find((s) => s.value === 'folder:')).toBeTruthy()
  })

  it.concurrent('returns filter values for key with colon', () => {
    const result = engine.getSuggestions('level:')
    expect(result?.type).toBe('filter-values')
    expect(result?.filterKey).toBe('level')
    expect(result?.suggestions.find((s) => s.value === 'level:error')).toBeTruthy()
  })

  it.concurrent('returns partial filter matches when typing', () => {
    const result = engine.getSuggestions('level:err')
    expect(result?.type).toBe('filter-values')
    expect(result?.suggestions.some((s) => s.value.includes('err'))).toBe(true)
  })

  it.concurrent('returns workflow suggestions for workflow filter', () => {
    const result = engine.getSuggestions('workflow:crit')
    expect(result?.type).toBe('filter-values')
    expect(result?.filterKey).toBe('workflow')
    expect(result?.suggestions.find((s) => s.label === 'Critical Alerts')).toBeTruthy()
  })

  it.concurrent('returns folder suggestions for folder filter', () => {
    const result = engine.getSuggestions('folder:sha')
    expect(result?.type).toBe('filter-values')
    expect(result?.filterKey).toBe('folder')
    expect(result?.suggestions.find((s) => s.label === 'Shared')).toBeTruthy()
  })

  it.concurrent('returns multi-section suggestions for plain text queries', () => {
    const result = engine.getSuggestions('critical')
    expect(result?.type).toBe('multi-section')
    expect(result?.suggestions[0]?.id).toBe('show-all')
    expect(result?.sections?.some((section) => section.title === 'WORKFLOWS')).toBe(true)
  })

  it.concurrent('includes fallback filter suggestions when no matches found', () => {
    const result = engine.getSuggestions('something-random')
    expect(result?.type).toBe('multi-section')
    const filtersSection = result?.sections?.find((section) => section.title === 'SUGGESTED FILTERS')
    expect(filtersSection?.suggestions.length).toBeGreaterThan(0)
  })
})
