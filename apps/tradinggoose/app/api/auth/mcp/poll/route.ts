import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkPublicApiEndpointRateLimit } from '@/lib/api/rate-limit'
import { pollMcpDeviceLogin } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

const PollRequestSchema = z
  .object({
    code: z.string().min(1),
    verificationKey: z.string().min(1),
  })
  .strict()

export async function POST(request: NextRequest) {
  const rateLimit = await checkPublicApiEndpointRateLimit(request, 'mcp-auth-poll')
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimit.error || 'Rate limit exceeded' }, { status: 429 })
  }

  const parsed = PollRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid MCP login poll request' }, { status: 400 })
  }

  const result = await pollMcpDeviceLogin(parsed.data.code, parsed.data.verificationKey)
  return NextResponse.json(result)
}
