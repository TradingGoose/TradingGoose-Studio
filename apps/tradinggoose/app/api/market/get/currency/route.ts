import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const GetCurrencySchema = z.object({
  currency_id: optionalString,
  currencyId: optionalString,
})

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, ['currency_id', 'currencyId'])
  const parsed = GetCurrencySchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const currencyId = parsed.data.currency_id ?? parsed.data.currencyId
  if (!currencyId) {
    return NextResponse.json({ error: 'currency_id is required.' }, { status: 400 })
  }

  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  searchParams.set('currency_id', currencyId)
  searchParams.delete('currencyId')

  return proxyMarketRequest(request, ['get', 'currency'], searchParams)
}
