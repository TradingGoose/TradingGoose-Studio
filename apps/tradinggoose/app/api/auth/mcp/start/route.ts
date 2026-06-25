import { type NextRequest, NextResponse } from 'next/server'
import { startMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const baseUrl = getBaseUrl()
  const requester =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const login = await startMcpDeviceLogin(
    `${baseUrl}:${requester}:${request.headers.get('user-agent') ?? ''}`
  )
  if (!login) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  const authorizeUrl = new URL('/mcp/authorize', baseUrl)
  authorizeUrl.searchParams.set('code', login.code)

  return NextResponse.json({
    ...login,
    authorizeUrl: authorizeUrl.toString(),
  })
}
