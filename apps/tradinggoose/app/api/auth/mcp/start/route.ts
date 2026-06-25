import { type NextRequest, NextResponse } from 'next/server'
import { checkPublicApiEndpointRateLimit } from '@/lib/api/rate-limit'
import { startMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const rateLimit = await checkPublicApiEndpointRateLimit(request, 'mcp-auth-start')
  if (!rateLimit.allowed) {
    const status = rateLimit.failureKind === 'dependency' ? 503 : 429
    return NextResponse.json({ error: rateLimit.error || 'Rate limit exceeded' }, { status })
  }

  const baseUrl = getBaseUrl()
  const login = await startMcpDeviceLogin()
  const authorizeUrl = new URL('/mcp/authorize', baseUrl)
  authorizeUrl.searchParams.set('code', login.code)

  return NextResponse.json({
    ...login,
    authorizeUrl: authorizeUrl.toString(),
  })
}
