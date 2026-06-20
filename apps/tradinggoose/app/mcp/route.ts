import { type NextRequest, NextResponse } from 'next/server'
import { buildMcpInstallScript } from '../../lib/mcp/install-script'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return new NextResponse(buildMcpInstallScript(request.nextUrl.origin), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
