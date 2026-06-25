import { NextResponse } from 'next/server'
import { startMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'

export const dynamic = 'force-dynamic'

export async function POST() {
  const baseUrl = getBaseUrl()
  const login = await startMcpDeviceLogin()
  const authorizeUrl = new URL('/mcp/authorize', baseUrl)
  authorizeUrl.searchParams.set('code', login.code)

  return NextResponse.json({
    ...login,
    authorizeUrl: authorizeUrl.toString(),
  })
}
