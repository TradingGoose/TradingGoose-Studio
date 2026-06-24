import { NextResponse } from 'next/server'
import { McpDeviceLoginRateLimitError, startMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const baseUrl = getBaseUrl()
    const login = await startMcpDeviceLogin(`public:${new URL(baseUrl).host}`)
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
