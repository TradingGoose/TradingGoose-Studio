import { NextResponse } from 'next/server'
import { getPublicBillingCatalog } from '@/lib/billing/catalog'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const catalog = await getPublicBillingCatalog()

  return NextResponse.json(catalog, {
    status: 200,
    headers: NO_STORE_HEADERS,
  })
}
