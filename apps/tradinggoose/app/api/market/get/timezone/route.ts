import { type NextRequest } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = new URLSearchParams(request.nextUrl.searchParams)
  const timezoneName =
    params.get('timezone_name')?.trim() ||
    params.get('timezone')?.trim() ||
    params.get('name')?.trim() ||
    null

  if (timezoneName) {
    params.set('timezone_name', timezoneName)
    params.delete('timezone')
    params.delete('name')
  }

  return proxyMarketRequest(request, ['get', 'timezone'], params)
}
