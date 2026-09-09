import { describe, expect, it } from 'vitest'
import { cacheIbkrConid, clearIbkrConidCache } from '@/providers/trading/ibkr/client'
import {
  buildIbkrConidCacheKey,
  resolveIbkrConid,
  resolveIbkrConidFromApi,
  resolveIbkrConidSpec,
} from '@/providers/trading/ibkr/symbols'

describe('resolveIbkrConidSpec', () => {
  it('maps asset classes to IBKR security types', () => {
    expect(resolveIbkrConidSpec('stock')).toBe('STK')
    expect(resolveIbkrConidSpec('etf')).toBe('STK')
    expect(resolveIbkrConidSpec('future')).toBe('FUT')
    expect(resolveIbkrConidSpec('currency')).toBe('CASH')
    expect(resolveIbkrConidSpec('indice')).toBe('IND')
    expect(resolveIbkrConidSpec('mutualfund')).toBe('FUND')
    expect(resolveIbkrConidSpec(undefined)).toBe('STK')
  })
})

describe('buildIbkrConidCacheKey', () => {
  it('builds a normalized cache key', () => {
    expect(buildIbkrConidCacheKey('aapl', 'stock')).toBe('STK:AAPL')
    expect(buildIbkrConidCacheKey('ES', 'future')).toBe('FUT:ES')
  })
})

describe('resolveIbkrConid', () => {
  beforeEach(() => {
    clearIbkrConidCache()
  })

  it('returns cached conid', () => {
    cacheIbkrConid('STK:AAPL', 265598)
    const resolution = resolveIbkrConid({ symbol: 'AAPL', assetClass: 'stock' })
    expect(resolution).toEqual({ conid: 265598, conidSpec: 'STK' })
  })

  it('throws when conid is not cached', () => {
    expect(() => resolveIbkrConid({ symbol: 'AAPL', assetClass: 'stock' })).toThrow(
      'contract identifier not resolved'
    )
  })
})

describe('resolveIbkrConidFromApi', () => {
  beforeEach(() => {
    clearIbkrConidCache()
  })

  it('uses the cache when seeded', async () => {
    cacheIbkrConid('STK:MSFT', 272093)
    const resolution = await resolveIbkrConidFromApi({
      symbol: 'MSFT',
      assetClass: 'stock',
      accessToken: 'token',
    })
    expect(resolution.conid).toBe(272093)
  })

  it('throws without an access token on cache miss', async () => {
    await expect(resolveIbkrConidFromApi({ symbol: 'AAPL', assetClass: 'stock' })).rejects.toThrow(
      'access token is required'
    )
  })
})
