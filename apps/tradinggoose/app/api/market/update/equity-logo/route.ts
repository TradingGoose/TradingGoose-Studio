import { type NextRequest, NextResponse } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'

export const dynamic = 'force-dynamic'

const resolveEquityId = async (request: NextRequest) => {
  const fromQuery =
    request.nextUrl.searchParams.get('equity_id')?.trim() ??
    request.nextUrl.searchParams.get('equityId')?.trim()
  if (fromQuery) return fromQuery

  try {
    const body = (await request.clone().json()) as
      | { equity_id?: string; equityId?: string }
      | null
    const candidate = body?.equity_id ?? body?.equityId
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  } catch {
    // ignore invalid JSON
  }

  return null
}

export async function POST(request: NextRequest) {
  const equityId = await resolveEquityId(request)
  if (!equityId) {
    return NextResponse.json({ error: 'equity_id is required.' }, { status: 400 })
  }

  return proxyMarketRequest(request, ['update', 'equity-logo'])
}
