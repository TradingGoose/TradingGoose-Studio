import { describe, expect, it } from 'vitest'
import { LOGS_QUERY_POLICY, MONITOR_QUERY_POLICY } from './query-policy'
import { parseQuery, queryToApiParams, serializeQuery } from './query-parser'

describe('queryToApiParams', () => {
  it('emits exclusive lower and upper bound flags for strict comparisons', () => {
    const parsed = parseQuery('duration:>1000 cost:<0.5 date:>2026-04-01', MONITOR_QUERY_POLICY)

    expect(queryToApiParams(parsed, MONITOR_QUERY_POLICY)).toEqual(
      expect.objectContaining({
        durationMinMs: '1000',
        durationMinMsExclusive: 'true',
        costMax: '0.5',
        costMaxExclusive: 'true',
        startedAtFrom: '2026-04-01',
        startedAtFromExclusive: 'true',
      })
    )
  })

  it('round-trips logs-policy folder filters and id qualifiers', () => {
    const query = 'workflow:#wf-1 folder:"Alpha Folder" cost:>0.5 needs-review'
    const parsed = parseQuery(query, LOGS_QUERY_POLICY)

    expect(serializeQuery(parsed, LOGS_QUERY_POLICY)).toBe(query)
    expect(queryToApiParams(parsed, LOGS_QUERY_POLICY)).toEqual(
      expect.objectContaining({
        workflowIds: 'wf-1',
        folderName: 'Alpha Folder',
        costMin: '0.5',
        costMinExclusive: 'true',
        search: 'needs-review',
      })
    )
  })

  it('keeps the raw log-level status alias on the logs policy', () => {
    const query = 'status:error'
    const parsed = parseQuery(query, LOGS_QUERY_POLICY)

    expect(serializeQuery(parsed, LOGS_QUERY_POLICY)).toBe(query)
    expect(queryToApiParams(parsed, LOGS_QUERY_POLICY)).toEqual({
      level: 'error',
    })
  })

  it('round-trips monitor-policy quick filters and range clauses', () => {
    const query =
      'status:success provider:#alpaca assetType:stock has:monitor date:*..2026-04-30'
    const parsed = parseQuery(query, MONITOR_QUERY_POLICY)

    expect(serializeQuery(parsed, MONITOR_QUERY_POLICY)).toBe(query)
    expect(queryToApiParams(parsed, MONITOR_QUERY_POLICY)).toEqual(
      expect.objectContaining({
        outcomes: 'success',
        providerId: 'alpaca',
        assetTypes: 'stock',
        hasFields: 'monitor',
        startedAtTo: '2026-04-30',
      })
    )
  })

  it('preserves invalid qualifiers separately from valid clauses', () => {
    const parsed = parseQuery('workflow:#wf-1 bogus:thing stray', LOGS_QUERY_POLICY)

    expect(parsed.invalidQualifierFragments).toEqual(['bogus:thing'])
    expect(serializeQuery(parsed, LOGS_QUERY_POLICY)).toBe('workflow:#wf-1 stray')
  })

  it('supports presence-only indicator and endedAt qualifiers', () => {
    const query = 'has:indicator no:endedAt'
    const parsed = parseQuery(query, MONITOR_QUERY_POLICY)

    expect(serializeQuery(parsed, MONITOR_QUERY_POLICY)).toBe(query)
    expect(queryToApiParams(parsed, MONITOR_QUERY_POLICY)).toEqual({
      hasFields: 'indicator',
      noFields: 'endedAt',
    })
  })

  it('round-trips comma-separated OR clauses for the logs policy', () => {
    const query = 'workflow:"Alpha Desk",Beta folder:"North Folder","South Folder" level:error,info'
    const parsed = parseQuery(query, LOGS_QUERY_POLICY)

    expect(serializeQuery(parsed, LOGS_QUERY_POLICY)).toBe(query)
    expect(queryToApiParams(parsed, LOGS_QUERY_POLICY)).toEqual({
      workflowName: 'Alpha Desk,Beta',
      folderName: 'North Folder,South Folder',
      level: 'error,info',
    })
  })

  it('round-trips comma-separated OR clauses for the monitor policy', () => {
    const query =
      'status:success,error provider:#alpaca,#binance interval:1m,5m assetType:stock,crypto'
    const parsed = parseQuery(query, MONITOR_QUERY_POLICY)

    expect(serializeQuery(parsed, MONITOR_QUERY_POLICY)).toBe(
      'status:error,success provider:#alpaca,#binance interval:1m,5m assetType:crypto,stock'
    )
    expect(queryToApiParams(parsed, MONITOR_QUERY_POLICY)).toEqual({
      outcomes: 'error,success',
      providerId: 'alpaca,binance',
      interval: '1m,5m',
      assetTypes: 'crypto,stock',
    })
  })

  it('rejects mixed-mode OR groups instead of coercing them into id clauses', () => {
    const parsed = parseQuery('workflow:#wf-1,"Alpha"', LOGS_QUERY_POLICY)

    expect(parsed.invalidQualifierFragments).toEqual(['workflow:#wf-1,"Alpha"'])
    expect(parsed.clauses).toEqual([])
    expect(queryToApiParams(parsed, LOGS_QUERY_POLICY)).toEqual({})
  })

  it('canonicalizes OR-value order when generating clause ids and raw text', () => {
    const parsed = parseQuery('status:success,error', MONITOR_QUERY_POLICY)

    expect(parsed.clauses[0]?.id).toBe('status:error,success')
    expect(parsed.clauses[0]?.raw).toBe('status:error,success')
    expect(serializeQuery(parsed, MONITOR_QUERY_POLICY)).toBe('status:error,success')
  })

  it('round-trips comma-separated listing clauses for the monitor policy', () => {
    const aaplListing =
      '"{\\"listing_id\\":\\"AAPL\\",\\"base_id\\":\\"\\",\\"quote_id\\":\\"\\",\\"listing_type\\":\\"default\\"}"'
    const msftListing =
      '"{\\"listing_id\\":\\"MSFT\\",\\"base_id\\":\\"\\",\\"quote_id\\":\\"\\",\\"listing_type\\":\\"default\\"}"'
    const query = `listing:${aaplListing},${msftListing}`
    const parsed = parseQuery(query, MONITOR_QUERY_POLICY)

    expect(serializeQuery(parsed, MONITOR_QUERY_POLICY)).toBe(query)
    expect(
      JSON.parse(
        queryToApiParams(parsed, MONITOR_QUERY_POLICY).listings as string
      )
    ).toEqual([
      {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      {
        listing_id: 'MSFT',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    ])
  })

  it('drops removed qualifiers and negated ranges instead of emitting positive filters', () => {
    const query =
      'execution:#legacy workflowId:#wf-1 executionId:#exec-1 -date:>2026-04-01 -duration:1000..5000 -cost:<0.5 keep'
    const parsed = parseQuery(query, LOGS_QUERY_POLICY)

    expect(parsed.invalidQualifierFragments).toEqual([
      'execution:#legacy',
      'workflowId:#wf-1',
      'executionId:#exec-1',
      '-date:>2026-04-01',
      '-duration:1000..5000',
      '-cost:<0.5',
    ])
    expect(serializeQuery(parsed, LOGS_QUERY_POLICY)).toBe('keep')
    expect(queryToApiParams(parsed, LOGS_QUERY_POLICY)).toEqual({
      search: 'keep',
    })
  })

  it('preserves mixed text and clause segment order in parsed queries', () => {
    const query = 'alpha workflow:#wf-1 "beta gamma" status:error'
    const parsed = parseQuery(query, LOGS_QUERY_POLICY)

    expect(parsed.segments).toEqual([
      { kind: 'text', value: 'alpha' },
      {
        kind: 'clause',
        clause: expect.objectContaining({ field: 'workflow', raw: 'workflow:#wf-1' }),
      },
      { kind: 'text', value: 'beta gamma' },
      {
        kind: 'clause',
        clause: expect.objectContaining({ field: 'status', raw: 'status:error' }),
      },
    ])
    expect(serializeQuery(parsed, LOGS_QUERY_POLICY)).toBe(query)
  })
})
