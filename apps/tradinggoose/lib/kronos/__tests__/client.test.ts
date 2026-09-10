import { KronosErrorCode, KronosError, ForecastRequestSchema } from '@/lib/kronos/types'
import { getMaxHorizon, isKronosEnabled, callKronosForecast } from '@/lib/kronos/client'

describe('kronos types', () => {
  test('ForecastRequestSchema accepts a valid request', () => {
    const result = ForecastRequestSchema.safeParse({
      requestId: 'request-1',
      listing: { listingId: 'AAPL', listingType: 'stock' },
      interval: '5m',
      timezone: 'America/New_York',
      normalizationMode: 'raw',
      history: Array.from({ length: 32 }, (_, i) => ({
        timestamp: `2026-01-02T14:${30 + i}:00+00:00`,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 1000 + i,
      })),
      futureTimestamps: ['2026-01-02T15:05:00+00:00'],
      parameters: { temperature: 1.0, topP: 0.9, sampleCount: 1 },
    })
    expect(result.success).toBe(true)
  })

  test('ForecastRequestSchema rejects too few history bars', () => {
    const result = ForecastRequestSchema.safeParse({
      requestId: 'request-1',
      listing: { listingId: 'AAPL', listingType: 'stock' },
      interval: '5m',
      timezone: 'America/New_York',
      history: [
        {
          timestamp: '2026-01-02T14:30:00+00:00',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
        },
      ],
      futureTimestamps: ['2026-01-02T14:35:00+00:00'],
    })
    expect(result.success).toBe(false)
  })

  test('ForecastRequestSchema rejects invalid timezone', () => {
    const result = ForecastRequestSchema.safeParse({
      requestId: 'request-1',
      listing: { listingId: 'AAPL', listingType: 'stock' },
      interval: '5m',
      timezone: 'Invalid/Timezone',
      history: Array.from({ length: 32 }, (_, i) => ({
        timestamp: `2026-01-02T14:${30 + i}:00+00:00`,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
      })),
      futureTimestamps: ['2026-01-02T15:05:00+00:00'],
    })
    expect(result.success).toBe(false)
  })

  test('ForecastRequestSchema rejects duplicate timestamps', () => {
    const result = ForecastRequestSchema.safeParse({
      requestId: 'request-1',
      listing: { listingId: 'AAPL', listingType: 'stock' },
      interval: '5m',
      timezone: 'America/New_York',
      history: Array.from({ length: 32 }, () => ({
        timestamp: '2026-01-02T14:30:00+00:00',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      })),
      futureTimestamps: ['2026-01-02T14:35:00+00:00'],
    })
    expect(result.success).toBe(false)
  })

  test('ForecastRequestSchema rejects future timestamps before last bar', () => {
    const result = ForecastRequestSchema.safeParse({
      requestId: 'request-1',
      listing: { listingId: 'AAPL', listingType: 'stock' },
      interval: '5m',
      timezone: 'America/New_York',
      history: Array.from({ length: 32 }, (_, i) => ({
        timestamp: `2026-01-02T14:${30 + i}:00+00:00`,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
      })),
      futureTimestamps: ['2026-01-02T14:30:00+00:00'],
    })
    expect(result.success).toBe(false)
  })
})

describe('kronos client utilities', () => {
  beforeEach(() => {
    delete process.env.KRONOS_ENABLED
    delete process.env.KRONOS_INTERNAL_URL
    delete process.env.KRONOS_INTERNAL_TOKEN
    delete process.env.KRONOS_MAX_HORIZON
  })

  test('isKronosEnabled returns false when env vars are missing', () => {
    expect(isKronosEnabled()).toBe(false)
  })

  test('isKronosEnabled returns true when all env vars are set', () => {
    process.env.KRONOS_ENABLED = 'true'
    process.env.KRONOS_INTERNAL_URL = 'http://kronos:8000'
    process.env.KRONOS_INTERNAL_TOKEN = 'this-is-a-test-token-thats-long-enough-32'
    expect(isKronosEnabled()).toBe(true)
  })

  test('getMaxHorizon returns default when not configured', () => {
    expect(getMaxHorizon()).toBe(32)
  })

  test('getMaxHorizon returns configured value', () => {
    process.env.KRONOS_MAX_HORIZON = '16'
    expect(getMaxHorizon()).toBe(16)
  })

  test('callKronosForecast throws DISABLED when not enabled', async () => {
    await expect(
      callKronosForecast({
        requestId: 'request-1',
        listing: { listingId: 'AAPL', listingType: 'stock' },
        interval: '5m',
        timezone: 'America/New_York',
        history: Array.from({ length: 32 }, (_, i) => ({
          timestamp: `2026-01-02T14:${30 + i}:00+00:00`,
          open: 100 + i,
          high: 102 + i,
          low: 99 + i,
          close: 101 + i,
        })),
        futureTimestamps: ['2026-01-02T15:05:00+00:00'],
      })
    ).rejects.toMatchObject({ code: KronosErrorCode.DISABLED })
  })

  test('callKronosForecast throws HORIZON_EXCEEDED when horizon is too large', async () => {
    process.env.KRONOS_ENABLED = 'true'
    process.env.KRONOS_INTERNAL_URL = 'http://kronos:8000'
    process.env.KRONOS_INTERNAL_TOKEN = 'this-is-a-test-token-thats-long-enough-32'
    process.env.KRONOS_MAX_HORIZON = '12'

    await expect(
      callKronosForecast({
        requestId: 'request-1',
        listing: { listingId: 'AAPL', listingType: 'stock' },
        interval: '5m',
        timezone: 'America/New_York',
        history: Array.from({ length: 32 }, (_, i) => ({
          timestamp: `2026-01-02T14:${30 + i}:00+00:00`,
          open: 100 + i,
          high: 102 + i,
          low: 99 + i,
          close: 101 + i,
        })),
        futureTimestamps: Array.from(
          { length: 13 },
          (_, i) => `2026-01-02T${15 + Math.floor((i + 32) / 60)}:${((32 + i) % 60)
            .toString()
            .padStart(2, '0')}:00+00:00`
        ),
      })
    ).rejects.toMatchObject({ code: KronosErrorCode.HORIZON_EXCEEDED })
  })
})
