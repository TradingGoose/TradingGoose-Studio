import { marketClient } from '@/lib/market/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { DATE_KEY_RE } from './constants'
import { toDateKey, toDateKeyValue } from './date-utils'
import type { MarketHoursResponse } from './types'

const marketHoursCache = new Map<string, MarketHoursResponse | null>()

const extractMarketHoursResponse = (payload: unknown): MarketHoursResponse | null => {
  if (!payload || typeof payload !== 'object') return null
  if ('error' in payload && (payload as { error?: unknown }).error) return null

  const data =
    'data' in payload &&
    (payload as { data?: unknown }).data &&
    typeof (payload as { data?: unknown }).data === 'object'
      ? (payload as { data?: unknown }).data
      : payload

  if (!data || typeof data !== 'object') return null

  const marketHours =
    (data as MarketHoursResponse).marketHours ??
    (data as { marketHors?: MarketHoursResponse['marketHours'] }).marketHors ??
    null
  if (!marketHours) return null

  return {
    isHoliday: (data as MarketHoursResponse).isHoliday ?? false,
    timeZone: (data as MarketHoursResponse).timeZone,
    marketHours,
  }
}

export const resolveMarketHours = async (
  listingId: string,
  listingType: string,
  date: Date
): Promise<MarketHoursResponse | null> => {
  const dateKey = toDateKey(date)
  const cacheKey = `${listingId}:${listingType}:${dateKey}`
  if (marketHoursCache.has(cacheKey)) {
    return marketHoursCache.get(cacheKey) ?? null
  }

  const params = new URLSearchParams({
    listing_id: listingId,
    listingType,
    date: dateKey,
    version: MARKET_API_VERSION,
  })
  const response = await marketClient.makeRequest<MarketHoursResponse>(
    `/api/get/market-hours?${params.toString()}`
  )
  if (!response.success) {
    marketHoursCache.set(cacheKey, null)
    return null
  }
  const normalized = extractMarketHoursResponse(response.data)
  if (!normalized) {
    marketHoursCache.set(cacheKey, null)
    return null
  }
  marketHoursCache.set(cacheKey, normalized)
  return normalized
}

export const resolveMarketHoursRange = async (
  listingId: string,
  listingType: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, MarketHoursResponse> | null> => {
  const params = new URLSearchParams({
    listing_id: listingId,
    listingType,
    startDate: toDateKey(startDate),
    endDate: toDateKey(endDate),
    version: MARKET_API_VERSION,
  })
  const response = await marketClient.makeRequest<unknown>(
    `/api/get/market-hours?${params.toString()}`
  )
  if (!response.success) return null

  const payload = response.data
  if (!payload || typeof payload !== 'object') return null
  if ('error' in payload && (payload as { error?: unknown }).error) return null

  const root =
    'data' in payload &&
    (payload as { data?: unknown }).data &&
    typeof (payload as { data?: unknown }).data === 'object'
      ? (payload as { data?: unknown }).data
      : payload

  const entries: Array<[string, MarketHoursResponse]> = []
  const pushEntry = (dateKey: string | null, value: unknown) => {
    if (!dateKey) return
    const normalized = extractMarketHoursResponse(value)
    if (!normalized) return
    entries.push([dateKey, normalized])
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      if (!item || typeof item !== 'object') continue
      const dateKey = toDateKeyValue(
        (item as { date?: unknown }).date ??
          (item as { day?: unknown }).day ??
          (item as { sessionDate?: unknown }).sessionDate ??
          (item as { marketDate?: unknown }).marketDate
      )
      pushEntry(dateKey, item)
    }
  } else if (root && typeof root === 'object') {
    const possibleList =
      (root as { days?: unknown }).days ??
      (root as { items?: unknown }).items ??
      (root as { marketDays?: unknown }).marketDays
    if (Array.isArray(possibleList)) {
      for (const item of possibleList) {
        if (!item || typeof item !== 'object') continue
        const dateKey = toDateKeyValue(
          (item as { date?: unknown }).date ??
            (item as { day?: unknown }).day ??
            (item as { sessionDate?: unknown }).sessionDate ??
            (item as { marketDate?: unknown }).marketDate
        )
        pushEntry(dateKey, item)
      }
    } else {
      for (const [key, value] of Object.entries(root)) {
        if (!DATE_KEY_RE.test(key)) continue
        pushEntry(key, value)
      }
    }
  }

  if (!entries.length) return null
  const result = new Map<string, MarketHoursResponse>()
  for (const [key, value] of entries) {
    result.set(key, value)
    marketHoursCache.set(`${listingId}:${listingType}:${key}`, value)
  }
  return result
}
