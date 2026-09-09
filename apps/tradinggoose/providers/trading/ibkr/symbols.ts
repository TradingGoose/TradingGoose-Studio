import type { AssetClass } from '@/providers/market/types'
import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import {
  buildIbkrApiUrl,
  cacheIbkrConid,
  getCachedIbkrConid,
} from '@/providers/trading/ibkr/client'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'

export interface IbkrConidResolution {
  conid: number
  conidSpec: string
}

const ibkrSpecByAssetClass: Partial<Record<AssetClass, string>> = {
  stock: 'STK',
  etf: 'STK',
  future: 'FUT',
  currency: 'CASH',
  indice: 'IND',
  mutualfund: 'FUND',
}

export const resolveIbkrConidSpec = (assetClass?: AssetClass | null): string =>
  (assetClass && ibkrSpecByAssetClass[assetClass]) || 'STK'

export const buildIbkrConidCacheKey = (symbol: string, assetClass?: AssetClass | null): string =>
  `${resolveIbkrConidSpec(assetClass)}:${symbol.trim().toUpperCase()}`

interface SecDefResponseItem {
  conid?: number | string
  secType?: string
}

/**
 * Resolve an IBKR contract identifier for a symbol and seed the in-memory
 * conid cache. Call this ahead of order submission — the shared order pipeline
 * is synchronous and reads conid values from the cache (see resolveIbkrConid).
 */
export async function resolveIbkrConidFromApi({
  symbol,
  assetClass,
  accessToken,
}: {
  symbol: string
  assetClass?: AssetClass | null
  accessToken?: string
}): Promise<IbkrConidResolution> {
  const normalizedSymbol = symbol.trim().toUpperCase()
  if (!normalizedSymbol) {
    throw new Error('IBKR order requires a symbol')
  }

  const conidSpec = resolveIbkrConidSpec(assetClass)
  const cacheKey = buildIbkrConidCacheKey(normalizedSymbol, assetClass)
  const cachedConid = getCachedIbkrConid(cacheKey)
  if (cachedConid !== undefined) {
    return { conid: cachedConid, conidSpec }
  }

  if (!accessToken) {
    throw new Error('IBKR access token is required to resolve contracts')
  }

  const searchParams = new URLSearchParams({ symbol: normalizedSymbol })
  if (conidSpec !== 'STK') {
    searchParams.set('secType', conidSpec)
  }

  const response = await fetchBrokerJson<{ contracts?: SecDefResponseItem[] }>({
    providerId: 'ibkr',
    url: `${buildIbkrApiUrl('/iserver/secdef/search')}?${searchParams.toString()}`,
    init: {
      method: 'POST',
      headers: {
        ...buildIbkrAuthHeaders({ accessToken }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ symbol: normalizedSymbol }),
    },
  })

  const contract = response?.contracts?.find((candidate) => {
    if (conidSpec === 'STK') return true
    return (candidate?.secType ?? '').toUpperCase() === conidSpec
  })

  const rawConid = contract?.conid
  const conid = typeof rawConid === 'string' ? Number(rawConid) : rawConid
  if (typeof conid !== 'number' || !Number.isFinite(conid)) {
    throw new Error(`Unable to resolve IBKR contract identifier for symbol ${normalizedSymbol}`)
  }

  cacheIbkrConid(cacheKey, conid)
  return { conid, conidSpec }
}

/**
 * Synchronous conid lookup against the in-memory cache.
 * See resolveIbkrConidFromApi for how the cache is seeded.
 */
export function resolveIbkrConid({
  symbol,
  assetClass,
}: {
  symbol: string
  assetClass?: AssetClass | null
}): IbkrConidResolution {
  const normalizedSymbol = symbol.trim().toUpperCase()
  if (!normalizedSymbol) {
    throw new Error('IBKR order requires a symbol')
  }

  const conidSpec = resolveIbkrConidSpec(assetClass)
  const cacheKey = buildIbkrConidCacheKey(normalizedSymbol, assetClass)
  const cachedConid = getCachedIbkrConid(cacheKey)
  if (cachedConid !== undefined) {
    return { conid: cachedConid, conidSpec }
  }

  throw new Error(
    `IBKR contract identifier not resolved for symbol ${normalizedSymbol}. ` +
      'Run resolveIbkrConidFromApi first so the conid cache is seeded for order submission.'
  )
}
