import { type NextRequest, NextResponse } from 'next/server'
import { revokeMcpApiKeyByBearerToken } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const token = authorization.slice('Bearer '.length).trim()
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
