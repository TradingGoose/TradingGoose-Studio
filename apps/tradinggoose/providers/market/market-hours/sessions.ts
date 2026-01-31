import { parseUtcOffsetMinutes } from '@/lib/time-format'
import type { MarketSeries, MarketSeriesRequest, MarketSessionWindow } from '@/providers/market/types'
import { MAX_SESSION_LOOKAHEAD_DAYS, MAX_SESSION_RANGE_DAYS, MARKET_DAY_MS } from './constants'
import { addDays, parseDateKey, toDate, toDateKey } from './date-utils'
import { resolveMarketHours, resolveMarketHoursRange } from './market-hours-api'
import { parseTime } from './time-utils'
import type { MarketHoursResponse, MarketSession } from './types'

type SessionRange = { startMs: number; endMs: number }

const toSeconds = (time?: string) => {
  const parsed = parseTime(time)
  if (!parsed) return null
  return parsed.hours * 3600 + parsed.minutes * 60 + parsed.seconds
}

const resolveRegularSessionWindow = (
  marketHours: NonNullable<MarketHoursResponse['marketHours']>
) => {
  const marketStart = marketHours.market?.start
  const marketEnd = marketHours.market?.end
  const postStart = marketHours.postmarket?.start
  const marketEndSeconds = toSeconds(marketEnd)
  const postStartSeconds = toSeconds(postStart)
  const end =
    marketEnd &&
    postStart &&
    marketEndSeconds != null &&
    postStartSeconds != null &&
    postStartSeconds < marketEndSeconds
      ? postStart
      : marketEnd
  return {
    start: marketStart,
    end,
  }
}

const resolveExtendedSessionWindow = (
  marketHours: NonNullable<MarketHoursResponse['marketHours']>
) => {
  const marketStart = marketHours.market?.start
  const marketEnd = marketHours.market?.end
  const preStart = marketHours.premarket?.start
  const postEnd = marketHours.postmarket?.end
  return {
    start: preStart ?? marketStart,
    end: postEnd ?? marketEnd,
  }
}

const resolveSessionWindowBounds = (
  date: Date,
  session: { start?: string; end?: string } | undefined,
  utcOffsetMinutes: number
) => {
  const start = parseTime(session?.start)
  const end = parseTime(session?.end)
  if (!start || !end) return null

  const localStartMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    start.hours,
    start.minutes,
    start.seconds
  )
  const localEndMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    end.hours,
    end.minutes,
    end.seconds
  )
  if (!Number.isFinite(localStartMs) || !Number.isFinite(localEndMs)) return null
  const startMs = localStartMs - utcOffsetMinutes * 60_000
  const endMs = localEndMs - utcOffsetMinutes * 60_000
  if (endMs <= startMs) return null
  return { startMs, endMs }
}

export const resolveMarketSessionsForRange = async (
  listingId: string,
  listingType: string,
  startMs: number,
  endMs: number
): Promise<MarketSessionWindow[] | null> => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null

  const dayCount = Math.floor((endMs - startMs) / MARKET_DAY_MS) + 1
  if (dayCount <= 0) return null
  if (dayCount > MAX_SESSION_RANGE_DAYS) return null

  const rangeMap = await resolveMarketHoursRange(
    listingId,
    listingType,
    new Date(startMs - MARKET_DAY_MS),
    new Date(endMs + MARKET_DAY_MS)
  )

  const dateKeys = rangeMap ? Array.from(rangeMap.keys()).sort() : []

  const fallbackStartDate = new Date(startMs)
  const fallbackStartDayMs = Date.UTC(
    fallbackStartDate.getUTCFullYear(),
    fallbackStartDate.getUTCMonth(),
    fallbackStartDate.getUTCDate()
  )
  const fallbackEndDate = new Date(endMs)
  const fallbackEndDayMs = Date.UTC(
    fallbackEndDate.getUTCFullYear(),
    fallbackEndDate.getUTCMonth(),
    fallbackEndDate.getUTCDate()
  )
  const fallbackDayCount =
    Number.isFinite(fallbackStartDayMs) && Number.isFinite(fallbackEndDayMs)
      ? Math.floor((fallbackEndDayMs - fallbackStartDayMs) / MARKET_DAY_MS) + 1
      : 0

  const sessions: MarketSessionWindow[] = []
  const totalDays = dateKeys.length || fallbackDayCount
  for (let i = 0; i < totalDays; i += 1) {
    const dateKey = dateKeys.length
      ? dateKeys[i]
      : toDateKey(new Date(fallbackStartDayMs + i * MARKET_DAY_MS))
    const dateCursor = parseDateKey(dateKey) ?? new Date(dateKey)
    const hoursResponse =
      rangeMap?.get(dateKey) ?? (await resolveMarketHours(listingId, listingType, dateCursor))
    if (!hoursResponse || hoursResponse.isHoliday || !hoursResponse.marketHours) continue

    const offset = hoursResponse.timeZone?.utcOffset ?? '+00:00'
    let offsetMinutes = 0
    try {
      offsetMinutes = parseUtcOffsetMinutes(offset)
    } catch {
      offsetMinutes = 0
    }

    const timezone = hoursResponse.timeZone?.name
    const utcOffset = hoursResponse.timeZone?.utcOffset
    const sessionsByType: Array<{
      type: MarketSessionWindow['type']
      window?: { start?: string; end?: string }
    }> = [
      { type: 'premarket', window: hoursResponse.marketHours?.premarket },
      { type: 'market', window: resolveRegularSessionWindow(hoursResponse.marketHours) },
      { type: 'postmarket', window: hoursResponse.marketHours?.postmarket },
    ]

    for (const sessionEntry of sessionsByType) {
      const bounds = resolveSessionWindowBounds(dateCursor, sessionEntry.window, offsetMinutes)
      if (!bounds) continue
      if (bounds.endMs < startMs || bounds.startMs > endMs) continue
      sessions.push({
        date: dateKey,
        type: sessionEntry.type,
        start: new Date(bounds.startMs).toISOString(),
        end: new Date(bounds.endMs).toISOString(),
        timezone,
        utcOffset,
      })
    }
  }

  if (!sessions.length) return []
  sessions.sort((a, b) => a.start.localeCompare(b.start))
  return sessions
}

export const resolveSeriesBoundsMs = (
  series: MarketSeries
): { startMs: number; endMs: number } | null => {
  const startMs = series.start ? Date.parse(series.start) : NaN
  const endMs = series.end ? Date.parse(series.end) : NaN
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs) {
    return { startMs, endMs }
  }

  const bars = Array.isArray(series.bars) ? series.bars : []
  if (!bars.length) return null
  const times = bars
    .map((bar) => Date.parse(bar.timeStamp))
    .filter((ts) => Number.isFinite(ts))
  if (!times.length) return null
  const min = Math.min(...times)
  const max = Math.max(...times)
  return Number.isFinite(min) && Number.isFinite(max) && min < max
    ? { startMs: min, endMs: max }
    : null
}

const buildSessionRanges = (
  sessions: MarketSessionWindow[],
  mode: 'regular' | 'extended'
): SessionRange[] => {
  const allowed =
    mode === 'regular'
      ? new Set<MarketSessionWindow['type']>(['market'])
      : new Set<MarketSessionWindow['type']>(['premarket', 'market', 'postmarket'])
  const ranges: SessionRange[] = []

  sessions.forEach((session) => {
    if (!allowed.has(session.type)) return
    const startMs = Date.parse(session.start)
    const endMs = Date.parse(session.end)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return
    ranges.push({ startMs, endMs })
  })

  return ranges.sort((a, b) => a.startMs - b.startMs)
}

const isTimestampInRanges = (timestamp: number, ranges: SessionRange[]) => {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const range = ranges[mid]
    if (timestamp < range.startMs) {
      high = mid - 1
    } else if (timestamp > range.endMs) {
      low = mid + 1
    } else {
      return true
    }
  }
  return false
}

export const filterSeriesBySessions = (
  series: MarketSeries,
  sessions: MarketSessionWindow[],
  mode: 'regular' | 'extended'
): MarketSeries => {
  if (!sessions.length) return series
  const ranges = buildSessionRanges(sessions, mode)
  if (!ranges.length) return series
  const bars = Array.isArray(series.bars) ? series.bars : []
  if (!bars.length) return series
  const filteredBars = bars.filter((bar) => {
    const ts = Date.parse(bar.timeStamp)
    return Number.isFinite(ts) && isTimestampInRanges(ts, ranges)
  })
  if (filteredBars.length === bars.length) return series
  const start = filteredBars[0]?.timeStamp ?? series.start
  const end = filteredBars.length
    ? filteredBars[filteredBars.length - 1]?.timeStamp ?? series.end
    : series.end
  return { ...series, bars: filteredBars, start, end }
}

export const filterSessionsToRange = (
  sessions: MarketSessionWindow[],
  startMs: number,
  endMs: number
) =>
  sessions.filter((session) => {
    const sessionStart = Date.parse(session.start)
    const sessionEnd = Date.parse(session.end)
    if (!Number.isFinite(sessionStart) || !Number.isFinite(sessionEnd)) return false
    return sessionEnd >= startMs && sessionStart <= endMs
  })

const resolveSessionBounds = (
  date: Date,
  marketHours: NonNullable<MarketHoursResponse['marketHours']>,
  utcOffsetMinutes: number,
  session: MarketSession
) => {
  const regularWindow = resolveRegularSessionWindow(marketHours)
  const extendedWindow = resolveExtendedSessionWindow(marketHours)
  const sessionStart =
    session === 'extended'
      ? parseTime(extendedWindow.start)
      : parseTime(regularWindow.start)
  const sessionEnd =
    session === 'extended' ? parseTime(extendedWindow.end) : parseTime(regularWindow.end)
  if (!sessionStart || !sessionEnd) return null

  const localStartMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    sessionStart.hours,
    sessionStart.minutes,
    sessionStart.seconds
  )
  const localEndMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    sessionEnd.hours,
    sessionEnd.minutes,
    sessionEnd.seconds
  )
  if (!Number.isFinite(localStartMs) || !Number.isFinite(localEndMs)) return null
  const startMs = localStartMs - utcOffsetMinutes * 60_000
  const endMs = localEndMs - utcOffsetMinutes * 60_000
  return { startMs, endMs }
}

export const resolveLatestSessionEndMs = async (
  listingId: string,
  listingType: string,
  session: MarketSession
): Promise<number | null> => {
  const nowMs = Date.now()
  const endDate = new Date(nowMs)
  const startDate = addDays(endDate, -(MAX_SESSION_LOOKAHEAD_DAYS - 1))
  const rangeMap = await resolveMarketHoursRange(
    listingId,
    listingType,
    startDate,
    endDate
  )
  const candidateKeys = rangeMap ? Array.from(rangeMap.keys()).sort().reverse() : []

  const resolveEndFromHours = (
    dateCursor: Date,
    hoursResponse: MarketHoursResponse
  ): number | null => {
    if (hoursResponse.isHoliday || !hoursResponse.marketHours) return null
    const offset = hoursResponse.timeZone?.utcOffset ?? '+00:00'
    let offsetMinutes = 0
    try {
      offsetMinutes = parseUtcOffsetMinutes(offset)
    } catch {
      offsetMinutes = 0
    }
    const bounds = resolveSessionBounds(
      dateCursor,
      hoursResponse.marketHours,
      offsetMinutes,
      session
    )
    if (!bounds) return null
    if (bounds.startMs <= nowMs && bounds.endMs >= nowMs) {
      return nowMs
    }
    if (bounds.endMs <= nowMs) {
      return bounds.endMs
    }
    return null
  }

  for (const dateKey of candidateKeys) {
    const dateCursor = parseDateKey(dateKey) ?? new Date(dateKey)
    const hoursResponse =
      rangeMap?.get(dateKey) ?? (await resolveMarketHours(listingId, listingType, dateCursor))
    if (!hoursResponse) continue
    const resolved = resolveEndFromHours(dateCursor, hoursResponse)
    if (resolved !== null) return resolved
  }

  for (let i = 0; i < MAX_SESSION_LOOKAHEAD_DAYS; i += 1) {
    const dateCursor = addDays(endDate, -i)
    const hoursResponse = await resolveMarketHours(listingId, listingType, dateCursor)
    if (!hoursResponse) continue
    const resolved = resolveEndFromHours(dateCursor, hoursResponse)
    if (resolved !== null) return resolved
  }

  return null
}

export const resolveListingId = (listing?: MarketSeries['listing'] | null) => {
  if (!listing) return null
  if (listing.listing_type === 'equity') return listing.equity_id?.trim() || null
  return null
}

export const clampToMarketSession = async (
  request: MarketSeriesRequest
): Promise<MarketSeriesRequest> => {
  const session = request.providerParams?.marketSession as MarketSession | undefined
  if (session !== 'regular' && session !== 'extended') return request
  const listing = request.listing
  if (!listing || listing.listing_type !== 'equity') return request
  const listingId = resolveListingId(listing)
  if (!listingId) return request

  const startDate = toDate(request.start)
  const endDate = toDate(request.end)
  if (!startDate || !endDate) return request

  let startMs = startDate.getTime()
  let endMs = endDate.getTime()

  const adjustStart = async () => {
    let cursor = new Date(startMs)
    const rangeStart = addDays(cursor, -1)
    const rangeEnd = addDays(cursor, MAX_SESSION_LOOKAHEAD_DAYS)
    const rangeMap = await resolveMarketHoursRange(
      listingId,
      listing.listing_type,
      rangeStart,
      rangeEnd
    )
    const candidateKeys = rangeMap ? Array.from(rangeMap.keys()).sort() : []
    for (let i = 0; i < MAX_SESSION_LOOKAHEAD_DAYS; i += 1) {
      const dateKey = candidateKeys[i]
      const dateCursor = dateKey
        ? parseDateKey(dateKey) ?? new Date(dateKey)
        : addDays(cursor, i)
      const hoursResponse =
        (dateKey ? rangeMap?.get(dateKey) : null) ??
        (await resolveMarketHours(listingId, listing.listing_type, dateCursor))
      if (!hoursResponse || hoursResponse.isHoliday || !hoursResponse.marketHours) {
        continue
      }
      const offset = hoursResponse.timeZone?.utcOffset ?? '+00:00'
      let offsetMinutes = 0
      try {
        offsetMinutes = parseUtcOffsetMinutes(offset)
      } catch {
        offsetMinutes = 0
      }
      const bounds = resolveSessionBounds(
        dateCursor,
        hoursResponse.marketHours,
        offsetMinutes,
        session
      )
      if (!bounds) {
        continue
      }
      if (startMs < bounds.startMs) {
        startMs = bounds.startMs
      } else if (startMs > bounds.endMs) {
        const nextCursor = addDays(dateCursor, 1)
        startMs = nextCursor.getTime()
        continue
      }
      return
    }
  }

  const adjustEnd = async () => {
    let cursor = new Date(endMs)
    const rangeStart = addDays(cursor, -MAX_SESSION_LOOKAHEAD_DAYS)
    const rangeEnd = addDays(cursor, 1)
    const rangeMap = await resolveMarketHoursRange(
      listingId,
      listing.listing_type,
      rangeStart,
      rangeEnd
    )
    const candidateKeys = rangeMap ? Array.from(rangeMap.keys()).sort().reverse() : []
    for (let i = 0; i < MAX_SESSION_LOOKAHEAD_DAYS; i += 1) {
      const dateKey = candidateKeys[i]
      const dateCursor = dateKey
        ? parseDateKey(dateKey) ?? new Date(dateKey)
        : addDays(cursor, -i)
      const hoursResponse =
        (dateKey ? rangeMap?.get(dateKey) : null) ??
        (await resolveMarketHours(listingId, listing.listing_type, dateCursor))
      if (!hoursResponse || hoursResponse.isHoliday || !hoursResponse.marketHours) {
        continue
      }
      const offset = hoursResponse.timeZone?.utcOffset ?? '+00:00'
      let offsetMinutes = 0
      try {
        offsetMinutes = parseUtcOffsetMinutes(offset)
      } catch {
        offsetMinutes = 0
      }
      const bounds = resolveSessionBounds(
        dateCursor,
        hoursResponse.marketHours,
        offsetMinutes,
        session
      )
      if (!bounds) {
        continue
      }
      if (endMs > bounds.endMs) {
        endMs = bounds.endMs
      } else if (endMs < bounds.startMs) {
        const prevCursor = addDays(dateCursor, -1)
        endMs = prevCursor.getTime()
        continue
      }
      return
    }
  }

  await Promise.all([adjustStart(), adjustEnd()])

  if (startMs >= endMs) {
    return request
  }

  return {
    ...request,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  }
}
