import { describe, expect, it } from 'vitest'
import { LOGS_QUERY_POLICY, MONITOR_QUERY_POLICY } from './query-policy'
import { createSearchClause } from './query-parser'
import { SearchSuggestions } from './search-suggestions'

describe('SearchSuggestions', () => {
  const engine = new SearchSuggestions({
    policy: MONITOR_QUERY_POLICY,
    workflowsData: [{ id: 'wf-1', name: 'Critical Alerts' }],
    monitorRows: [
      {
        monitorId: 'monitor-1',
        monitorLabel: 'RSI Monitor',
        providerId: 'alpaca',
        interval: '1m',
        listing: null,
        listingLabel: 'AAPL',
      },
    ],
  })

  it('returns qualifier suggestions for empty input', () => {
    const result = engine.getSuggestions('')
    expect(result?.type).toBe('qualifiers')
    expect(result?.suggestions.some((suggestion) => suggestion.value === 'monitor:')).toBe(true)
  })

  it('advertises the raw log-level status alias in the logs policy', () => {
    const logsEngine = new SearchSuggestions({
      policy: LOGS_QUERY_POLICY,
    })
    const result = logsEngine.getSuggestions('')

    expect(result?.suggestions.some((suggestion) => suggestion.value === 'status:')).toBe(true)
    expect(result?.suggestions.some((suggestion) => suggestion.value === 'level:')).toBe(true)
  })

  it('returns presence suggestions for indicator and endedAt fields', () => {
    const result = engine.getSuggestions('has:')
    expect(result?.type).toBe('values')
    expect(result?.suggestions.some((suggestion) => suggestion.value === 'has:indicator')).toBe(true)
    expect(result?.suggestions.some((suggestion) => suggestion.value === 'has:endedAt')).toBe(true)
  })

  it('keeps partial presence suggestions available after the colon', () => {
    expect(engine.getSuggestions('has:mo')?.suggestions.map((suggestion) => suggestion.value)).toEqual([
      'has:monitor',
    ])
    expect(engine.getSuggestions('no:co')?.suggestions.map((suggestion) => suggestion.value)).toEqual(
      ['no:cost']
    )
  })

  it('does not expose presence-only fields as bare qualifier suggestions', () => {
    const result = engine.getSuggestions('')

    expect(result?.suggestions.some((suggestion) => suggestion.value === 'indicator:')).toBe(false)
    expect(result?.suggestions.some((suggestion) => suggestion.value === 'endedAt:')).toBe(false)
  })

  it('returns monitor-row suggestions for the monitor qualifier', () => {
    const result = engine.getSuggestions('monitor:rsi')
    expect(result?.type).toBe('values')
    expect(result?.filterKey).toBe('monitor')
    expect(result?.suggestions[0]?.value).toBe('monitor:#monitor-1')
  })

  it('returns field-qualified example suggestions for example-only fields', () => {
    const result = engine.getSuggestions('date:')

    expect(result?.type).toBe('values')
    expect(result?.suggestions[0]?.value).toBe('date:>=2026-01-01')
  })

  it('keeps negated field suggestions aligned with the current qualifier input', () => {
    const result = engine.getSuggestions('-status:')

    expect(result?.type).toBe('values')
    expect(result?.suggestions.every((suggestion) => suggestion.value.startsWith('-status:'))).toBe(
      true
    )
    expect(result?.suggestions.some((suggestion) => suggestion.value === '-status:success')).toBe(
      true
    )
  })

  it('matches the policy-defined static-options and examples-only suggestion sources', () => {
    const policies = [
      { engine: new SearchSuggestions({ policy: LOGS_QUERY_POLICY }), policy: LOGS_QUERY_POLICY },
      { engine: new SearchSuggestions({ policy: MONITOR_QUERY_POLICY }), policy: MONITOR_QUERY_POLICY },
    ]

    policies.forEach(({ engine: policyEngine, policy }) => {
      policy.orderedFields
        .filter((field) => field.suggestionSource === 'staticOptions')
        .forEach((field) => {
          expect(policyEngine.getSuggestions(`${field.key}:`)?.suggestions.map((suggestion) => suggestion.value)).toEqual(
            (field.staticOptions ?? []).map((option) => `${field.key}:${option.value}`)
          )
        })

      policy.orderedFields
        .filter(
          (field) =>
            field.suggestionSource === 'examplesOnly' &&
            (field.examples?.length ?? 0) > 0
        )
        .forEach((field) => {
          expect(policyEngine.getSuggestions(`${field.key}:`)?.suggestions.map((suggestion) => suggestion.value)).toEqual(
            (field.examples ?? []).map((example) =>
              example.startsWith(`${field.key}:`) ? example : `${field.key}:${example}`
            )
          )
        })
    })
  })

  it('matches id-backed suggestions when the user types the # prefix', () => {
    const workflowEngine = new SearchSuggestions({
      policy: MONITOR_QUERY_POLICY,
      workflowsData: [{ id: 'wf-1', name: 'Critical Alerts' }],
      monitorRows: [
        {
          monitorId: 'monitor-1',
          monitorLabel: 'RSI Monitor',
          providerId: 'alpaca',
          interval: '1m',
          listing: null,
          listingLabel: 'AAPL',
        },
      ],
    })

    expect(workflowEngine.getSuggestions('workflow:#wf')?.suggestions[0]?.value).toBe('workflow:#wf-1')
    expect(workflowEngine.getSuggestions('monitor:#monitor')?.suggestions[0]?.value).toBe(
      'monitor:#monitor-1'
    )
    expect(workflowEngine.getSuggestions('provider:#alp')?.suggestions[0]?.value).toBe(
      'provider:#alpaca'
    )
  })

  it('emits listing suggestions in the same quoted clause shape the parser expects', () => {
    const listing = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    const listingEngine = new SearchSuggestions({
      policy: MONITOR_QUERY_POLICY,
      monitorRows: [
        {
          monitorId: 'monitor-1',
          monitorLabel: 'RSI Monitor',
          providerId: 'alpaca',
          interval: '1m',
          listing,
          listingLabel: 'AAPL',
        },
      ],
    })

    const expected = createSearchClause(
      {
        kind: 'field',
        field: 'listing',
        negated: false,
        operator: '=',
        valueMode: 'listing',
        values: [JSON.stringify(listing)],
      },
      MONITOR_QUERY_POLICY
    ).raw

    expect(listingEngine.getSuggestions('listing:aap')?.suggestions[0]?.value).toBe(expected)
  })

  it('only exposes folder suggestions for the logs policy', () => {
    const folderData = [{ id: 'folder-1', name: 'Alpha Desk' }]
    const logsEngine = new SearchSuggestions({
      policy: LOGS_QUERY_POLICY,
      foldersData: folderData,
    })
    const monitorEngine = new SearchSuggestions({
      policy: MONITOR_QUERY_POLICY,
      foldersData: folderData,
    })

    const logsResult = logsEngine.getSuggestions('alpha')
    const monitorResult = monitorEngine.getSuggestions('alpha')

    expect(logsResult?.sections?.some((section) => section.title === 'Folders')).toBe(true)
    expect(monitorResult?.sections?.some((section) => section.title === 'Folders')).toBe(false)
    expect(monitorResult?.suggestions.some((suggestion) => suggestion.category === 'folder')).toBe(
      false
    )
  })
})
