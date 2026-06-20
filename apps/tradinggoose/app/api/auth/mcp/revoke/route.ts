import { type NextRequest, NextResponse } from 'next/server'
import { revokeMcpApiKeyByBearerToken } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return null
  }

  const token = match[1].trim()
  return token || null
}

export async function POST(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) {
    return NextResponse.json({ error: 'Bearer token required' }, { status: 400 })
  }

  const result = await revokeMcpApiKeyByBearerToken(token)
  return NextResponse.json(result)
}
