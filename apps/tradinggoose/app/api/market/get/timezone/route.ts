import { type NextRequest } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = new URLSearchParams()
  const timezoneName = request.nextUrl.searchParams.get('timezone_name')?.trim() || null
  if (timezoneName) {
    params.set('timezone_name', timezoneName)
  }

  const version = request.nextUrl.searchParams.get('version')?.trim()
  if (version) {
    params.set('version', version)
  }

  return proxyMarketRequest(request, ['get', 'timezone'], params)
}
