import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const MarketHoursSchema = z.object({
  listing_id: optionalString,
  listingType: optionalString,
  date: optionalString,
  startDate: optionalString,
  endDate: optionalString,
})

const allowedListingTypes = new Set(['default', 'crypto', 'currency'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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
    'listing_id',
    'listingType',
    'date',
    'startDate',
    'endDate',
  ])
  const parsed = MarketHoursSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const listingId = parsed.data.listing_id?.trim()
  const listingTypeRaw = parsed.data.listingType?.trim() ?? null
  const listingType = listingTypeRaw ? listingTypeRaw.toLowerCase() : null
  const date = parsed.data.date?.trim()
  const startDate = parsed.data.startDate?.trim()
  const endDate = parsed.data.endDate?.trim()

  if (!listingId || !listingTypeRaw) {
    return NextResponse.json(
      { error: 'listing_id and listingType are required.' },
      { status: 400 }
    )
  }

  if (!listingType || !allowedListingTypes.has(listingType)) {
    return NextResponse.json(
      { error: 'listingType must be default, crypto, or currency.' },
      { status: 400 }
    )
  }

  if ((startDate && !endDate) || (!startDate && endDate)) {
    return NextResponse.json(
      { error: 'startDate and endDate must be provided together.' },
      { status: 400 }
    )
  }

  if (startDate && endDate && date) {
    return NextResponse.json(
      { error: 'Use either date or startDate/endDate, not both.' },
      { status: 400 }
    )
  }

  if (startDate && endDate) {
    const parsedStartDate = parseDateYmd(startDate)
    const parsedEndDate = parseDateYmd(endDate)

    if (!parsedStartDate || !parsedEndDate) {
      return NextResponse.json(
        { error: 'startDate and endDate must be in YYYY-MM-DD format.' },
        { status: 400 }
      )
    }

    if (parsedStartDate.getTime() > parsedEndDate.getTime()) {
      return NextResponse.json(
        { error: 'startDate must be on or before endDate.' },
        { status: 400 }
      )
    }
  }

  if (date && !parseDateYmd(date)) {
    return NextResponse.json(
      { error: 'date must be in YYYY-MM-DD format.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams()
  searchParams.set('listing_id', listingId)
  searchParams.set('listingType', listingType)
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
