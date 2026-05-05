import { describe, expect, it } from 'vitest'
import { buildPublicLogExecutionData, toLogExecutionDataRecord } from './log-utils'

describe('buildPublicLogExecutionData', () => {
  it('does not spread arbitrary stored executionData fields', () => {
    const result = buildPublicLogExecutionData({
      storedExecutionData: {
        environment: { userId: 'user-1' },
        tokenBreakdown: { total: 100 },
        models: { model: { total: 1 } },
        traceSpans: ['stored-span'],
        finalOutput: 'stored-output',
      },
      totalDuration: 250,
      traceSpans: ['public-span'],
      blockExecutions: ['public-block'],
      finalOutput: 'public-output',
    })

    expect(result).toEqual({
      totalDuration: 250,
      traceSpans: ['public-span'],
      blockExecutions: ['public-block'],
      finalOutput: 'public-output',
      enhanced: true,
    })
  })

  it('keeps only the monitor trigger fields used by the monitor UI', () => {
    const result = buildPublicLogExecutionData({
      storedExecutionData: {
        trigger: {
          source: 'indicator_trigger',
          timestamp: '2026-05-05T00:00:00.000Z',
          data: {
            executionTarget: 'deployed',
            monitor: {
              id: 'monitor-1',
              workflowId: 'workflow-1',
              blockId: 'block-1',
              providerId: 'alpaca',
              interval: '1m',
              indicatorId: 'rsi',
              listing: {
                listing_type: 'default',
                listing_id: 'AAPL',
                base_id: '',
                quote_id: '',
                assetClass: 'stock',
                name: 'Apple Inc.',
              },
            },
          },
        },
      },
      totalDuration: 250,
      traceSpans: [],
      blockExecutions: [],
      finalOutput: undefined,
    })

    expect(result).toEqual({
      totalDuration: 250,
      traceSpans: [],
      blockExecutions: [],
      finalOutput: undefined,
      enhanced: true,
      trigger: {
        source: 'indicator_trigger',
        data: {
          monitor: {
            id: 'monitor-1',
            providerId: 'alpaca',
            interval: '1m',
            indicatorId: 'rsi',
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              assetClass: 'stock',
            },
          },
        },
      },
    })
  })
})

describe('toLogExecutionDataRecord', () => {
  it('rejects non-record executionData values', () => {
    expect(toLogExecutionDataRecord(null)).toBeNull()
    expect(toLogExecutionDataRecord(['not', 'a', 'record'])).toBeNull()
    expect(toLogExecutionDataRecord({ traceSpans: [] })).toEqual({ traceSpans: [] })
  })
})
