import { marketClient } from '@/lib/market/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { isUtcOffset, normalizeUtcOffset, parseUtcOffsetMinutes } from '@/lib/time-format'

export type TimeZoneResponse = {
  name: string
  utcOffset: string
  dstOn: boolean
  observesDst: boolean
}

export type ResolvedTimeZone = TimeZoneResponse & {
  storageValue: string
  utcOffsetMinutes: number
}

export const resolveTimezoneState = async (value: string): Promise<ResolvedTimeZone> => {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Time zone name is required')
  if (isUtcOffset(trimmed)) {
    const normalized = normalizeUtcOffset(trimmed)
    const utcOffsetMinutes = parseUtcOffsetMinutes(normalized)
    return {
      name: 'UTC',
      utcOffset: normalized,
      dstOn: false,
      observesDst: false,
      storageValue: normalized,
      utcOffsetMinutes,
    }
  }

  const params = new URLSearchParams({ timezone_name: trimmed, version: MARKET_API_VERSION })
  const response = await marketClient.makeRequest<TimeZoneResponse>(`/api/get/timezone?${params}`)
  if (!response.success) throw new Error(response.error || 'Market timezone request failed')
  const data = response.data
  if (!data?.name || typeof data.utcOffset !== 'string') {
    throw new Error('Invalid market timezone response')
  }
  return {
    ...data,
    storageValue: data.observesDst ? data.name : data.utcOffset,
    utcOffsetMinutes: parseUtcOffsetMinutes(data.utcOffset),
  }
}
