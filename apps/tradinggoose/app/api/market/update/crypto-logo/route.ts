import { type NextRequest, NextResponse } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'

export const dynamic = 'force-dynamic'

const resolveCryptoId = async (request: NextRequest) => {
  const fromQuery =
    request.nextUrl.searchParams.get('crypto_id')?.trim() ??
    request.nextUrl.searchParams.get('cryptoId')?.trim()
  if (fromQuery) return fromQuery

  try {
    const body = (await request.clone().json()) as
      | { crypto_id?: string; cryptoId?: string }
      | null
    const candidate = body?.crypto_id ?? body?.cryptoId
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  } catch {
    // ignore invalid JSON
  }

  return null
}

export async function POST(request: NextRequest) {
  const cryptoId = await resolveCryptoId(request)
  if (!cryptoId) {
    return NextResponse.json({ error: 'crypto_id is required.' }, { status: 400 })
  }

  return proxyMarketRequest(request, ['update', 'crypto-logo'])
}
