import { describe, expect, it } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { HistoricalDataBlock } from '@/blocks/blocks/historical_data'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketSeriesRequest } from '@/providers/market/types'
import { historicalDataTool, type MarketSeriesParams } from '@/tools/market_data/series'
import { getToolParametersConfig } from '@/tools/params'

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
  mapParams({ provider: 'alpaca', listing, rangeMode: 'latest', interval: '1h', ...params })

const requestBody = (params: Record<string, unknown>) =>
  buildRequestBody(buildParams(params) as MarketSeriesParams) as Record<string, unknown>

describe('historical data range selection', () => {
  it('separates date mode from provider and interval dependent latest ranges', () => {
    expect(HistoricalDataBlock.subBlocks.find((field) => field.id === 'rangeMode')).toMatchObject({
      type: 'dropdown',
      required: true,
      options: [
        { id: 'custom', label: 'Custom dates' },
        { id: 'latest', label: 'Latest range' },
      ],
    })
    expect(HistoricalDataBlock.subBlocks.find((field) => field.id === 'interval')).toMatchObject({
      required: true,
      dependsOn: ['provider'],
    })
    expect(
      HistoricalDataBlock.subBlocks.find((field) => field.id === 'rangePresetId')
    ).toMatchObject({
      type: 'dropdown',
      required: true,
      dependsOn: ['provider', 'interval'],
      fetchOptions: expect.any(Function),
    })
  })

  it.each([
    ['alpaca', '1m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y']],
    ['alpaca', '3m', ['1d', '5d', '1w', '1m', '3m', '6m', '1y', '5y']],
    ['alpaca', '1h', ['1d', '5d', '1w', '1m', '3m', '6m', '1y', '5y']],
    ['yahoo-finance', '1m', ['1d', '5d', '1w']],
    ['yahoo-finance', '30m', ['1d', '5d', '1w', '1m']],
    ['yahoo-finance', '1mo', ['3m', '6m', '1y', '5y']],
    ['yahoo-finance', '3mo', ['6m', '1y', '5y', 'all']],
  ])(
    'limits %s latest ranges at %s to provider availability',
    async (provider, interval, expectedIds) => {
      const range = HistoricalDataBlock.subBlocks.find((field) => field.id === 'rangePresetId')
      const options = await range?.fetchOptions?.('block-1', 'rangePresetId', {
        channelId: 'main',
        workflowId: null,
        contextValues: { provider, interval },
      })

      expect(options?.map((option) => option.id)).toEqual(expectedIds)
    }
  )

  it('reads provider and interval from wrapped workflow context', async () => {
    const range = HistoricalDataBlock.subBlocks.find((field) => field.id === 'rangePresetId')
    const options = await range?.fetchOptions?.('block-1', 'rangePresetId', {
      channelId: 'main',
      workflowId: null,
      contextValues: { provider: { value: 'alpaca' }, interval: { value: '1h' } },
    })

    expect(options).toContainEqual({ id: '6m', label: 'Last 6 months' })
  })

  it.each(['1m', '1d', '1w', '1mo'])(
    'limits Alpha Vantage normalization options and request values at %s',
    async (interval) => {
      const normalization = HistoricalDataBlock.subBlocks.find(
        (field) => field.id === 'normalizationMode'
      )
      expect(normalization?.dependsOn).toEqual(['provider', 'interval'])
      const options = await normalization?.fetchOptions?.('block-1', 'normalizationMode', {
        channelId: 'main',
        workflowId: null,
        contextValues: { provider: { value: 'alpha-vantage' }, interval: { value: interval } },
      })
      expect(options?.some(({ id }) => id === 'split_adjusted')).toBe(interval === '1d')
      const body = requestBody({
        provider: 'alpha-vantage',
        interval,
        rangeMode: 'custom',
        start: '2026-10-01',
        end: '2026-10-26',
        normalizationMode: 'split_adjusted',
      })
      const planned = planMarketSeriesRequest(
        'alpha-vantage',
        body as unknown as MarketSeriesRequest
      )
      expect(planned.request.normalizationMode).toBe(
        interval === '1d' ? 'split_adjusted' : undefined
      )
    }
  )

  it.each([
    ['start', 'custom', 'latest'],
    ['end', 'custom', 'latest'],
    ['rangePresetId', 'latest', 'custom'],
  ])('shows %s only for its selected date mode', (id, active, inactive) => {
    const field = HistoricalDataBlock.subBlocks.find((subBlock) => subBlock.id === id)
    expect(field).toBeDefined()
    expect(evaluateSubBlockConditionValues(field?.condition, { rangeMode: active })).toBe(true)
    expect(evaluateSubBlockConditionValues(field?.condition, { rangeMode: inactive })).toBe(false)
  })

  it('keeps the interval available independently of date mode for blocks and Agent tools', () => {
    const params = getToolParametersConfig(
      'historical_data_fetch',
      HistoricalDataBlock
    )?.userInputParameters
    const condition = params?.find((param) => param.id === 'interval')?.uiComponent?.condition
    expect(params?.map((param) => param.id)).toEqual(expect.arrayContaining(['window', 'interval']))
    expect(params?.map((param) => param.id)).not.toContain('rangeMode')
    expect(params?.map((param) => param.id)).not.toContain('rangePresetId')
    expect(condition).toBeDefined()
    for (const rangeMode of [undefined, 'custom', 'latest']) {
      expect(evaluateSubBlockConditionValues(condition, { provider: 'alpaca', rangeMode })).toBe(
        true
      )
    }
    expect(evaluateSubBlockConditionValues(condition, { provider: 'unknown' })).toBe(false)
  })

  it.each([
    ['1d', { value: 1, unit: 'day' }, '15m'],
    ['1w', { value: 1, unit: 'week' }, '1h'],
    ['1m', { value: 1, unit: 'month' }, '1d'],
  ])(
    'requests latest %s without changing the selected interval',
    (rangePresetId, range, interval) => {
      const body = requestBody({ rangePresetId, interval, start: '2025-01-01', end: '2025-01-02' })
      expect(body).toMatchObject({
        provider: 'alpaca',
        listing,
        interval,
        windows: [{ mode: 'range', range }],
      })
      expect(body).not.toHaveProperty('start')
      expect(body).not.toHaveProperty('end')
    }
  )

  it('rejects a latest month beyond selected interval retention instead of changing the interval', () => {
    expect(
      buildParams({ provider: 'yahoo-finance', rangePresetId: '1m', interval: '1m' }).window
    ).toBeUndefined()
    const body = requestBody({ provider: 'yahoo-finance', rangePresetId: '1m', interval: '30m' })
    expect(body).toMatchObject({
      interval: '30m',
      windows: [{ mode: 'range', range: { value: 1, unit: 'month' } }],
    })
    const planned = planMarketSeriesRequest('yahoo-finance', body as unknown as MarketSeriesRequest)
    expect(planned.window).toEqual({ mode: 'range', rangeMs: 30 * 24 * 60 * 60 * 1000 })
  })

  it('rejects an Alpaca preset beyond the bar budget without changing the selected interval', () => {
    expect(buildParams({ rangePresetId: '5y', interval: '1m' }).window).toBeUndefined()
    expect(requestBody({ rangePresetId: '5y', interval: '3m' })).toMatchObject({
      interval: '3m',
      windows: [{ mode: 'range', range: { value: 5, unit: 'year' } }],
    })
  })

  it.each([
    ['yahoo-finance', '3mo'],
    ['alpha-vantage', '1mo'],
  ])(
    'requests all available %s history at the explicitly selected native interval',
    (provider, interval) => {
      const body = requestBody({
        provider,
        rangePresetId: 'all',
        interval,
        start: '1976-01-01',
        end: '2026-01-01',
      })
      expect(body).toMatchObject({ interval, windows: [{ mode: 'all' }] })
      const planned = planMarketSeriesRequest(provider, body as unknown as MarketSeriesRequest)
      expect(planned.window).toEqual({ mode: 'all' })
      expect(planned.request.start).toBeUndefined()
      expect(planned.request.end).toBeUndefined()
      expect(planned.request.providerParams?.limit).toBeUndefined()
    }
  )

  it('passes custom dates and their selected interval while ignoring a stale latest preset', () => {
    const start = '2026-09-01T00:00:00.000Z'
    const end = '2026-09-02T00:00:00.000Z'
    const body = requestBody({
      rangeMode: 'custom',
      rangePresetId: 'all',
      interval: '1h',
      start,
      end,
      apiKey: 'request-key',
      apiSecret: 'request-secret',
      feed: 'iex',
      normalizationMode: 'raw',
    })
    expect(body).toMatchObject({
      interval: '1h',
      windows: [{ mode: 'absolute', start, end }],
      auth: { apiKey: 'request-key', apiSecret: 'request-secret' },
      providerParams: { feed: 'iex' },
      normalizationMode: 'raw',
    })
    expect(body.providerParams).not.toHaveProperty('apiKey')
  })

  it.each([
    { rangeMode: undefined, rangePresetId: '1d' },
    { rangeMode: '', rangePresetId: '1d' },
    { rangeMode: 'unknown', rangePresetId: '1d' },
    { rangePresetId: undefined },
    { rangePresetId: '' },
    { rangePresetId: 'custom' },
    { rangePresetId: 'unknown' },
    { provider: 'alpaca', interval: '4h', rangePresetId: '1d' },
    { provider: 'robinhood', interval: '1m', rangePresetId: '1m' },
    { provider: 'robinhood', interval: '1h', rangePresetId: '5y' },
    { provider: 'yahoo-finance', interval: '1mo', rangePresetId: '1d' },
    { provider: 'yahoo-finance', interval: '1mo', rangePresetId: '1m' },
    { provider: 'yahoo-finance', interval: '3mo', rangePresetId: '3m' },
    { provider: 'yahoo-finance', interval: '1h', rangePresetId: '3m' },
    { provider: 'yahoo-finance', interval: '1h', rangePresetId: 'all' },
    { provider: 'alpaca', rangePresetId: 'all' },
    { provider: 'finnhub', rangePresetId: 'all' },
    { provider: 'robinhood', rangePresetId: 'all' },
  ])('does not infer a mode or substitute dates for invalid latest selections: %j', (selection) => {
    const params = buildParams({ ...selection, start: '2026-09-01', end: '2026-09-02' })
    expect(params.window).toBeUndefined()
    expect(historicalDataTool.params.window.required).toBe(true)
  })
})
