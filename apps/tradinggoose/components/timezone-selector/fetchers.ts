import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { formatTimezoneLabel, normalizeUtcOffset } from '@/lib/time-format'
import type { TimeZoneResponse } from '@/lib/timezone/timezone-resolver'
import type { BlockOptionLoaderContext } from '@/blocks/types'

export type TimeZoneOption = TimeZoneResponse & {
  id: string
  label: string
  searchLabel?: string
  rightLabel?: string
}

const DEFAULT_TZ_NAME_MAX_LENGTH = 24
const MARKET_TIMEZONE_TIMEOUT_MS = 15000

const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MARKET_TIMEZONE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Market timezone request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

const formatTimeZoneNameForDisplay = (name: string) => name.replace(/_/g, ' ')

const truncateTimeZoneName = (name: string, maxLength = DEFAULT_TZ_NAME_MAX_LENGTH) => {
  if (maxLength <= 0) return ''
  if (name.length <= maxLength) return name
  if (maxLength <= 3) return name.slice(0, maxLength)
  return `${name.slice(0, maxLength - 3)}...`
}

const formatUtcOffsetLabel = (value: string) => {
  const normalized = normalizeUtcOffset(value)
  return normalized === '+00:00' ? 'UTC+00:00' : `UTC${normalized}`
}

const fetchMarketTimeZones = async (): Promise<TimeZoneResponse | TimeZoneResponse[]> => {
  const params = new URLSearchParams({ version: MARKET_API_VERSION })

  const response = await fetchWithTimeout(`/api/market/get/timezone?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error || 'Market timezone request failed')
        : 'Market timezone request failed'
    throw new Error(errorMessage)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid market timezone response')
  }

  if ('error' in payload) {
    throw new Error(String((payload as { error?: unknown }).error || 'Market timezone error'))
  }

  return payload as TimeZoneResponse | TimeZoneResponse[]
}

let cachedTimeZoneOptions: TimeZoneOption[] | null = null
let timeZoneOptionsPromise: Promise<TimeZoneOption[]> | null = null

export const fetchTimeZoneOptions = async (
  _blockId?: string,
  _subBlockId?: string,
  _context?: BlockOptionLoaderContext
): Promise<TimeZoneOption[]> => {
  if (cachedTimeZoneOptions) return cachedTimeZoneOptions
  if (!timeZoneOptionsPromise) {
    timeZoneOptionsPromise = (async () => {
      const data = await fetchMarketTimeZones()
      const list = Array.isArray(data) ? data : [data]
      const options = list.map((entry) => {
        const offsetLabel = formatUtcOffsetLabel(entry.utcOffset)
        const displayName = formatTimeZoneNameForDisplay(entry.name)
        return {
          id: entry.name,
          label: truncateTimeZoneName(displayName),
          searchLabel: `${entry.name} ${displayName} (${offsetLabel})`,
          rightLabel: offsetLabel,
          name: entry.name,
          utcOffset: entry.utcOffset,
          dstOn: entry.dstOn,
          observesDst: entry.observesDst,
        }
      })
      cachedTimeZoneOptions = options
      return options
    })().catch((error) => {
      timeZoneOptionsPromise = null
      throw error
    })
  }
  return timeZoneOptionsPromise
}

export { formatTimezoneLabel }
