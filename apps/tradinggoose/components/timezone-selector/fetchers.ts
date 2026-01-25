import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import {
  formatTimezoneLabel,
  isUtcOffset,
  normalizeUtcOffset,
} from '@/lib/time-format'

export type TimeZoneResponse = {
  name: string
  utcOffset: string
  dstOn: boolean
  observesDst: boolean
}

export type TimeZoneOption = {
  id: string
  label: string
  searchLabel?: string
  rightLabel?: string
  name: string
  utcOffset: string
  dstOn: boolean
  observesDst: boolean
}

const DEFAULT_TZ_NAME_MAX_LENGTH = 24
const MARKET_TIMEZONE_TIMEOUT_MS = 15000

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = MARKET_TIMEZONE_TIMEOUT_MS
) => {
  const controller = new AbortController()
  const signal = init.signal
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
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

const fetchMarketTimeZones = async (
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<TimeZoneResponse | TimeZoneResponse[]> => {
  if (!params.get('version')) {
    params.set('version', MARKET_API_VERSION)
  }

  const response = await fetchWithTimeout(
    `/api/market/get/timezone?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
    }
  )

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
  _contextValues?: Record<string, any>
): Promise<TimeZoneOption[]> => {
  if (cachedTimeZoneOptions) return cachedTimeZoneOptions
  if (!timeZoneOptionsPromise) {
    timeZoneOptionsPromise = (async () => {
      const data = await fetchMarketTimeZones(new URLSearchParams())
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

export const fetchTimeZoneByName = async (
  name: string,
  signal?: AbortSignal
): Promise<TimeZoneResponse> => {
  const params = new URLSearchParams({ timezone_name: name })
  const data = await fetchMarketTimeZones(params, signal)
  if (Array.isArray(data)) {
    const match = data[0]
    if (!match) {
      throw new Error('Time zone not found')
    }
    return match
  }
  return data
}

export const resolveTimezoneOffset = async (
  value: string,
  signal?: AbortSignal
): Promise<string> => {
  const trimmed = value.trim()
  if (isUtcOffset(trimmed)) return normalizeUtcOffset(trimmed)
  const data = await fetchTimeZoneByName(trimmed, signal)
  return data.utcOffset
}

export { formatTimezoneLabel }
