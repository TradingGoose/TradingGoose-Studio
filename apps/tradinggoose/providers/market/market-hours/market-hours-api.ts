import { marketClient } from '@/lib/market/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { toDateKey } from './date-utils'
import type { MarketHoursResponse } from './types'

type MarketHoursData = Omit<MarketHoursResponse, 'marketHours'> & {
  marketHors?: MarketHoursResponse['marketHours']
}

const normalizeMarketHours = ({ marketHors, ...data }: MarketHoursData): MarketHoursResponse => ({
  ...data,
  marketHours: marketHors,
})

export const resolveMarketHours = async (
  listingId: string,
  listingType: string,
  date: Date
): Promise<MarketHoursResponse | null> => {
  const params = new URLSearchParams({
    listing_id: listingId,
    listingType,
    date: toDateKey(date),
    version: MARKET_API_VERSION,
  })
  const response = await marketClient.makeRequest<{ data: MarketHoursData }>(
    `/api/get/market-hours?${params.toString()}`
  )
  if (!response.success || !response.data?.data?.marketHors) return null
  return normalizeMarketHours(response.data.data)
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
  const response = await marketClient.makeRequest<{ data: Record<string, MarketHoursData> }>(
    `/api/get/market-hours?${params.toString()}`
  )
  if (!response.success || !response.data?.data) return null
  return new Map(
    Object.entries(response.data.data).map(([date, hours]) => [date, normalizeMarketHours(hours)])
  )
}
