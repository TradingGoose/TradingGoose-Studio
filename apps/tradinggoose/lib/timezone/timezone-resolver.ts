import { marketClient } from '@/lib/market/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import {
  isUtcOffset,
  normalizeUtcOffset,
  parseUtcOffsetMinutes,
} from '@/lib/time-format'

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

const fetchMarketTimeZones = async (
  params: URLSearchParams
): Promise<TimeZoneResponse | TimeZoneResponse[]> => {
  if (!params.get('version')) {
    params.set('version', MARKET_API_VERSION)
  }

  const response = await marketClient.makeRequest<TimeZoneResponse | TimeZoneResponse[]>(
    `/api/get/timezone?${params.toString()}`
  )

  if (!response.success) {
    throw new Error(response.error || 'Market timezone request failed')
  }

  const payload = response.data
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid market timezone response')
  }

  if ('error' in (payload as { error?: unknown })) {
    throw new Error(
      String((payload as { error?: unknown }).error || 'Market timezone error')
    )
  }

  return payload as TimeZoneResponse | TimeZoneResponse[]
}

export const fetchTimeZoneByName = async (name: string): Promise<TimeZoneResponse> => {
  const params = new URLSearchParams({ timezone_name: name })
  const data = await fetchMarketTimeZones(params)
  if (Array.isArray(data)) {
    const match = data[0]
    if (!match) {
      throw new Error('Time zone not found')
    }
    return match
  }
  return data
}

export const resolveTimezoneState = async (value: string): Promise<ResolvedTimeZone> => {
  const trimmed = value.trim()
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

  const data = await fetchTimeZoneByName(trimmed)
  return {
    ...data,
    storageValue: data.observesDst ? data.name : data.utcOffset,
    utcOffsetMinutes: parseUtcOffsetMinutes(data.utcOffset),
  }
}

export const resolveTimezoneOffset = async (value: string): Promise<string> => {
  const trimmed = value.trim()
  if (isUtcOffset(trimmed)) return normalizeUtcOffset(trimmed)
  const data = await fetchTimeZoneByName(trimmed)
  return data.utcOffset
}

export const resolveTimezoneOffsetMinutes = async (value: string): Promise<number> => {
  const offset = await resolveTimezoneOffset(value)
  return parseUtcOffsetMinutes(offset)
}

export const normalizeTimezoneValueForStorage = async (value: string): Promise<string> => {
  const trimmed = value.trim()
  if (!trimmed) return 'UTC'
  if (isUtcOffset(trimmed)) return normalizeUtcOffset(trimmed)
  const data = await fetchTimeZoneByName(trimmed)
  return data.observesDst ? data.name : data.utcOffset
}
