import { type NextRequest, NextResponse } from 'next/server'
import { checkPublicApiEndpointRateLimit } from '@/lib/api/rate-limit'
import { isApiKeyStorageAvailable } from '@/lib/api-key/service'
import { startConnectionLogin } from '@/lib/connect/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const rateLimit = await checkPublicApiEndpointRateLimit(request, 'connect-auth-start')
  if (!rateLimit.allowed) {
    const status = rateLimit.failureKind === 'dependency' ? 503 : 429
    return NextResponse.json({ error: rateLimit.error || 'Rate limit exceeded' }, { status })
  }
  if (!isApiKeyStorageAvailable()) {
    return NextResponse.json({ error: 'API key access is not configured' }, { status: 503 })
  }

  return NextResponse.json(await startConnectionLogin())
}
