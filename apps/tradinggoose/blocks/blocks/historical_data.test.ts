import { describe, expect, it } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { HistoricalDataBlock } from '@/blocks/blocks/historical_data'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketSeriesRequest } from '@/providers/market/types'
import { historicalDataTool, type MarketSeriesParams } from '@/tools/market_data/series'

const listing = {
  listing_id: 'us-aapl',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
} as const

const mapParams = HistoricalDataBlock.tools.config?.params
const buildRequestBody = historicalDataTool.request.body
if (!mapParams || !buildRequestBody) {
  throw new Error('Historical data parameter mapping and request body must be configured')
}

const buildParams = (params: Record<string, unknown>) =>
  mapParams({ provider: 'alpaca', listing, ...params })

const requestBody = (params: Record<string, unknown>) =>
  buildRequestBody(buildParams(params) as MarketSeriesParams) as Record<string, unknown>

describe('historical data range selection', () => {
  it('refreshes required range options when the selected provider changes', () => {
    const range = HistoricalDataBlock.subBlocks.find((subBlock) => subBlock.id === 'rangePresetId')

    expect(range).toMatchObject({
      type: 'dropdown',
      dependsOn: ['provider'],
      required: true,
      fetchOptions: expect.any(Function),
    })
  })

  it.each([
    ['alpaca', ['custom', '1d', '5d', '1w', '1m', '3m', '1y', '5y', 'all']],
    ['yahoo-finance', ['custom', '1d', '5d', '1m', '1y', '5y', 'all']],
  ])('limits %s ranges by supported intervals and retention', async (provider, expectedIds) => {
    const range = HistoricalDataBlock.subBlocks.find((subBlock) => subBlock.id === 'rangePresetId')
    expect(range?.fetchOptions).toBeTypeOf('function')

    const options = await range?.fetchOptions?.('block-1', 'rangePresetId', {
      channelId: 'main',
      workflowId: null,
      contextValues: { provider },
    })

    expect(options?.map((option) => option.id)).toEqual(expectedIds)
    expect(options?.some((option) => /^\d+h$/.test(option.id))).toBe(false)
  })

  it('reads provider values from wrapped workflow context', async () => {
    const range = HistoricalDataBlock.subBlocks.find((subBlock) => subBlock.id === 'rangePresetId')
    const options = await range?.fetchOptions?.('block-1', 'rangePresetId', {
      channelId: 'main',
      workflowId: null,
      contextValues: { provider: { value: 'alpaca' } },
    })

    expect(options?.map((option) => option.id)).toContain('1w')
  })

  it.each(['start', 'end', 'interval'])('shows %s only when custom dates are selected', (id) => {
    const field = HistoricalDataBlock.subBlocks.find((subBlock) => subBlock.id === id)
    expect(field).toBeDefined()
    expect(
      evaluateSubBlockConditionValues(field?.condition, {
        provider: 'alpaca',
        rangePresetId: 'custom',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockConditionValues(field?.condition, {
        provider: 'alpaca',
        rangePresetId: '1d',
      })
    ).toBe(false)
  })

  it.each([
    ['1d', { value: 1, unit: 'day' }, '1m'],
    ['1w', { value: 1, unit: 'week' }, '10m'],
    ['1m', { value: 1, unit: 'month' }, '30m'],
  ])('passes latest %s to the provider as a rolling window', (rangePresetId, range, interval) => {
    const body = requestBody({
      rangePresetId,
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-02T00:00:00.000Z',
    })

    expect(body).toMatchObject({
      provider: 'alpaca',
      listing,
      interval,
      windows: [{ mode: 'range', range }],
    })
    expect(body).not.toHaveProperty('start')
    expect(body).not.toHaveProperty('end')
  })

  it('uses the preset interval to preserve a full latest month despite a stale interval', () => {
    const body = requestBody({
      provider: 'yahoo-finance',
      rangePresetId: '1m',
      interval: '1m',
    })

    expect(body).toMatchObject({
      interval: '30m',
      windows: [{ mode: 'range', range: { value: 1, unit: 'month' } }],
    })

    const planned = planMarketSeriesRequest('yahoo-finance', body as unknown as MarketSeriesRequest)
    expect(planned.window).toEqual({ mode: 'range', rangeMs: 30 * 24 * 60 * 60 * 1000 })
    expect(planned.request.windows).toEqual([{ mode: 'range', range: { value: 30, unit: 'day' } }])
  })

  it('uses the preset interval when the saved interval is unsupported by the provider', () => {
    expect(requestBody({ rangePresetId: '1d', interval: '4h' })).toMatchObject({
      interval: '1m',
      windows: [{ mode: 'range', range: { value: 1, unit: 'day' } }],
    })
  })

  it('passes custom dates through the tool window contract', () => {
    const start = '2026-09-01T00:00:00.000Z'
    const end = '2026-09-02T00:00:00.000Z'

    expect(requestBody({ rangePresetId: 'custom', interval: '1h', start, end })).toMatchObject({
      interval: '1h',
      windows: [{ mode: 'absolute', start, end }],
    })
  })

  it.each([
    { rangePresetId: undefined },
    { rangePresetId: '' },
    { rangePresetId: 'unknown' },
    { rangePresetId: '1h' },
    { provider: 'yahoo-finance', rangePresetId: '1w' },
    { provider: 'yahoo-finance', rangePresetId: '3m' },
    { provider: 'alpaca', rangePresetId: '6m' },
  ])('does not substitute dates for an invalid range selection: %j', (selection) => {
    const params = buildParams({
      ...selection,
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-02T00:00:00.000Z',
    })

    expect(params.window).toBeUndefined()
    expect(historicalDataTool.params.window.required).toBe(true)
  })
})
