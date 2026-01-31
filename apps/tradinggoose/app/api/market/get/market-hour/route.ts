import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const MarketHourSchema = z.object({
  listingId: optionalString,
  listingType: optionalString,
  date: optionalString,
  startDate: optionalString,
  endDate: optionalString,
})

const allowedListingTypes = new Set(['equity', 'crypto', 'currency'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 30

const parseDateYmd = (value: string): Date | null => {
  if (!DATE_RE.test(value)) return null
  const [year, month, day] = value.split('-').map((part) => Number(part))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const utcMs = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(utcMs)) return null
  const date = new Date(utcMs)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [
    'listingId',
    'listingType',
    'date',
    'startDate',
    'endDate',
  ])
  const parsed = MarketHourSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const listingId = parsed.data.listingId?.trim()
  const listingTypeRaw = parsed.data.listingType?.trim().toLowerCase()
  const date = parsed.data.date?.trim()
  const startDate = parsed.data.startDate?.trim()
  const endDate = parsed.data.endDate?.trim()

  if (!listingId || !listingTypeRaw) {
    return NextResponse.json(
      { error: 'listingId and listingType are required.' },
      { status: 400 }
    )
  }

  if (!allowedListingTypes.has(listingTypeRaw)) {
    return NextResponse.json(
      { error: 'listingType must be equity, crypto, or currency.' },
      { status: 400 }
    )
  }

  const parsedDate = date ? parseDateYmd(date) : null
  const parsedStartDate = startDate ? parseDateYmd(startDate) : null
  const parsedEndDate = endDate ? parseDateYmd(endDate) : null

  if (date && !parsedDate) {
    return NextResponse.json(
      { error: 'date must be in YYYY-MM-DD format.' },
      { status: 400 }
    )
  }

  if (startDate && !parsedStartDate) {
    return NextResponse.json(
      { error: 'startDate must be in YYYY-MM-DD format.' },
      { status: 400 }
    )
  }

  if (endDate && !parsedEndDate) {
    return NextResponse.json(
      { error: 'endDate must be in YYYY-MM-DD format.' },
      { status: 400 }
    )
  }

  if ((startDate && !endDate) || (!startDate && endDate)) {
    return NextResponse.json(
      { error: 'startDate and endDate must be provided together.' },
      { status: 400 }
    )
  }

  if (date && startDate && endDate) {
    return NextResponse.json(
      { error: 'Use either date or startDate/endDate, not both.' },
      { status: 400 }
    )
  }

  if (parsedStartDate && parsedEndDate) {
    if (parsedStartDate.getTime() > parsedEndDate.getTime()) {
      return NextResponse.json(
        { error: 'startDate must be before or equal to endDate.' },
        { status: 400 }
      )
    }
    const rangeDays =
      Math.floor((parsedEndDate.getTime() - parsedStartDate.getTime()) / DAY_MS) + 1
    if (rangeDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Date range must be ${MAX_RANGE_DAYS} days or fewer.` },
        { status: 400 }
      )
    }
  }

  const searchParams = new URLSearchParams()
  searchParams.set('listingId', listingId)
  searchParams.set('listingType', listingTypeRaw)
  if (date) {
    searchParams.set('date', date)
  }
  if (startDate && endDate) {
    searchParams.set('startDate', startDate)
    searchParams.set('endDate', endDate)
  }

  const version = request.nextUrl.searchParams.get('version')?.trim()
  if (version) {
    searchParams.set('version', version)
  }

  return proxyMarketRequest(request, ['get', 'market-hours'], searchParams)
}
