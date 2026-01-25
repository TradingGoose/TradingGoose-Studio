import { type NextRequest } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return proxyMarketRequest(request, ['validate-key', 'delete'])
}
