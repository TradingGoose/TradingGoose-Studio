import { type NextRequest, NextResponse } from 'next/server'
import { startMcpDeviceLogin } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const login = await startMcpDeviceLogin()
  const authorizeUrl = new URL('/mcp/authorize', request.nextUrl.origin)
  authorizeUrl.searchParams.set('code', login.code)

  return NextResponse.json({
    ...login,
    authorizeUrl: authorizeUrl.toString(),
  })
}
