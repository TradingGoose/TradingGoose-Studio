import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheIbkrConid, clearIbkrConidCache } from '@/providers/trading/ibkr/client'
import {
  buildIbkrConidCacheKey,
  resolveIbkrConid,
  resolveIbkrConidFromApi,
  resolveIbkrConidSpec,
} from '@/providers/trading/ibkr/symbols'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'

vi.mock('@/providers/trading/portfolio-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/trading/portfolio-utils')>()
  return { ...actual, fetchBrokerJson: vi.fn() }
})

/**
 * Trimmed from a real POST /iserver/secdef/search response: a BARE ARRAY, the
 * conid as a string, and the available security types nested under `sections`.
 */
const aaplSecDefRows = [
  {
    conid: '265598',
    symbol: 'AAPL',
    description: 'NASDAQ',
    sections: [{ secType: 'STK' }, { secType: 'OPT', months: 'SEP26' }, { secType: 'CFD' }],
  },
  {
    conid: '532640894',
    symbol: 'AAPL',
    description: 'TSE',
    sections: [{ secType: 'STK' }],
  },
  {
    conid: '2147483647',
    symbol: null,
    description: null,
    sections: [{ secType: 'BOND' }],
  },
]

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
    vi.mocked(fetchBrokerJson).mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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

  it('resolves the primary listing from the bare-array response', async () => {
    vi.stubEnv('IBKR_API_BASE_URL', 'http://host.containers.internal:5002/v1/api')
    vi.mocked(fetchBrokerJson).mockResolvedValue(aaplSecDefRows as never)

    const resolution = await resolveIbkrConidFromApi({ symbol: 'AAPL', assetClass: 'stock' })

    expect(resolution).toEqual({ conid: 265598, conidSpec: 'STK' })
    expect(fetchBrokerJson).toHaveBeenCalledTimes(1)
  })

  it('still accepts a wrapped { contracts } envelope', async () => {
    vi.stubEnv('IBKR_API_BASE_URL', 'http://host.containers.internal:5002/v1/api')
    vi.mocked(fetchBrokerJson).mockResolvedValue({
      contracts: [{ conid: '272093', symbol: 'MSFT', sections: [{ secType: 'STK' }] }],
    } as never)

    const resolution = await resolveIbkrConidFromApi({ symbol: 'MSFT', assetClass: 'stock' })

    expect(resolution.conid).toBe(272093)
  })

  it('ignores rows that do not offer the requested asset class', async () => {
    // The bond row carries no STK section, so a stock lookup must not accept it.
    vi.stubEnv('IBKR_API_BASE_URL', 'http://host.containers.internal:5002/v1/api')
    vi.mocked(fetchBrokerJson).mockResolvedValue([
      { conid: '2147483647', symbol: null, sections: [{ secType: 'BOND' }] },
    ] as never)

    await expect(resolveIbkrConidFromApi({ symbol: 'AAPL', assetClass: 'stock' })).rejects.toThrow(
      'Unable to resolve IBKR contract identifier'
    )
  })

  it('requires an access token only against the hosted API', async () => {
    vi.stubEnv('IBKR_API_BASE_URL', 'https://api.ibkr.com/v1/api')

    await expect(resolveIbkrConidFromApi({ symbol: 'AAPL', assetClass: 'stock' })).rejects.toThrow(
      'hosted API requires an access token'
    )

    expect(fetchBrokerJson).not.toHaveBeenCalled()
  })
})
