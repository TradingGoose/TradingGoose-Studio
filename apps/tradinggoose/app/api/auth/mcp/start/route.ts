import { NextResponse } from 'next/server'
import { McpDeviceLoginRateLimitError, startMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

export async function POST() {
  const baseUrl = getBaseUrl()
  try {
    const login = await startMcpDeviceLogin()
    const authorizeUrl = new URL('/mcp/authorize', baseUrl)
    authorizeUrl.searchParams.set('code', login.code)

    return NextResponse.json({
      ...login,
      authorizeUrl: authorizeUrl.toString(),
    })
  } catch (error) {
    if (error instanceof McpDeviceLoginRateLimitError) {
      const retryAfter = Math.max(
        0,
        Math.ceil((error.resetAt.getTime() - Date.now()) / 1000)
      ).toString()
      return NextResponse.json(
        { error: error.message, retryAfter: error.resetAt.getTime() },
        { status: 429, headers: { 'Retry-After': retryAfter } }
      )
    }
    throw error
  }
}
