import { formatTimezoneLabel, isUtcOffset, parseUtcOffsetMinutes } from '@/lib/time-format'
import type { MonitorTimelineZoom } from '../view/view-config'

const FALLBACK_TIMEZONE = 'UTC'

const applyTimezoneOffset = (date: Date, timezone: string) => {
  if (!isUtcOffset(timezone)) return date
  return new Date(date.getTime() + parseUtcOffsetMinutes(timezone) * 60_000)
}

const buildDateFormatter = (timezone: string, options: Intl.DateTimeFormatOptions) => {
  const resolvedTimezone = timezone.trim() || FALLBACK_TIMEZONE
  const intlTimezone = isUtcOffset(resolvedTimezone) ? FALLBACK_TIMEZONE : resolvedTimezone

  try {
    return new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: intlTimezone,
    })
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: FALLBACK_TIMEZONE,
    })
  }
}

export const formatMonitorTimezoneLabel = (timezone: string) =>
  formatTimezoneLabel(timezone) || FALLBACK_TIMEZONE

export const formatMonitorDateTime = (date: Date, timezone: string) => {
  const adjustedDate = applyTimezoneOffset(date, timezone)
  return buildDateFormatter(timezone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(adjustedDate)
}

export const formatMonitorTimelineHeaderGroup = (
  date: Date,
  zoom: MonitorTimelineZoom,
  timezone: string
) => {
  const adjustedDate = applyTimezoneOffset(date, timezone)

  if (zoom === 'day') {
    return buildDateFormatter(timezone, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(adjustedDate)
  }

  return buildDateFormatter(timezone, {
    month: 'long',
    year: 'numeric',
  }).format(adjustedDate)
}

export const getMonitorTimelineHeaderGroupId = (
  date: Date,
  zoom: MonitorTimelineZoom,
  timezone: string
) => {
  const adjustedDate = applyTimezoneOffset(date, timezone)
  const parts = buildDateFormatter(timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(adjustedDate)
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'
  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')

  return zoom === 'day' ? `${year}-${month}-${day}` : `${year}-${month}`
}

export const getMonitorTimelineBoundaryBucket = (
  date: Date,
  zoom: MonitorTimelineZoom,
  timezone: string
) => {
  if (zoom === 'day') {
    return getMonitorTimelineHeaderGroupId(date, 'day', timezone)
  }
  if (zoom === 'week') {
    return getMonitorTimelineHeaderGroupId(date, 'month', timezone)
  }
  return getMonitorTimelineHeaderGroupId(date, 'month', timezone)
}

export const formatMonitorTimelinePrimaryLabel = (
  date: Date,
  zoom: MonitorTimelineZoom,
  timezone: string
) => {
  const adjustedDate = applyTimezoneOffset(date, timezone)

  switch (zoom) {
    case 'day':
      return buildDateFormatter(timezone, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(adjustedDate)
        .replace(/\s/g, ' ')
    case 'week':
    case 'month':
      return buildDateFormatter(timezone, {
        day: 'numeric',
      }).format(adjustedDate)
  }
}

export const formatMonitorTimelineTickTitle = (
  date: Date,
  zoom: MonitorTimelineZoom,
  timezone: string
) => {
  const adjustedDate = applyTimezoneOffset(date, timezone)

  if (zoom === 'day') {
    return buildDateFormatter(timezone, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(adjustedDate)
  }

  return buildDateFormatter(timezone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(adjustedDate)
}
