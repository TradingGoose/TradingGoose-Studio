import { type NextRequest, NextResponse } from 'next/server'
import { McpDeviceLoginRateLimitError, startMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

function getRequesterKey(request: NextRequest, baseUrl: string) {
  const requester =
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'

  return `public:${new URL(baseUrl).host}:${requester}`
}

export async function POST(request: NextRequest) {
  try {
    const baseUrl = getBaseUrl()
    const login = await startMcpDeviceLogin(getRequesterKey(request, baseUrl))
    const authorizeUrl = new URL('/mcp/authorize', baseUrl)
    authorizeUrl.searchParams.set('code', login.code)

    return NextResponse.json({
      ...login,
      authorizeUrl: authorizeUrl.toString(),
    })
  } catch (error) {
    if (error instanceof McpDeviceLoginRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 })
    }
    throw error
  }
}
