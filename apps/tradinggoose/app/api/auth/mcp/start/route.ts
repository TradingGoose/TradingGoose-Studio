import { type NextRequest, NextResponse } from 'next/server'
import { McpDeviceLoginRateLimitError, startMcpDeviceLogin } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const requesterKey =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      'unknown'
    const login = await startMcpDeviceLogin(requesterKey)
    const authorizeUrl = new URL('/mcp/authorize', request.nextUrl.origin)
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
