import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CurrencyRankSchema = z.object({
  currency_id: optionalString,
  currencyId: optionalString,
  currency_code: optionalString,
  code: optionalString,
})

export async function POST(request: NextRequest) {
  const params = buildQueryParams(request, [
    'currency_id',
    'currencyId',
    'currency_code',
    'code',
  ])
  const parsed = CurrencyRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const currencyId = parsed.data.currency_id ?? parsed.data.currencyId
  const currencyCode = parsed.data.currency_code ?? parsed.data.code

  if (!currencyId && !currencyCode) {
    return NextResponse.json(
      { error: 'currency_id is required.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams()
  if (currencyId) {
    searchParams.set('currency_id', currencyId)
  } else if (currencyCode) {
    searchParams.set('currency_code', currencyCode)
  }
  return proxyMarketRequest(request, ['update', 'currency-rank'], searchParams)
}
