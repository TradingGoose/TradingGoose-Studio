import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkPublicApiEndpointRateLimit } from '@/lib/api/rate-limit'
import { isApiKeyStorageAvailable } from '@/lib/api-key/service'
import { acknowledgeMcpDeviceLogin, pollMcpDeviceLogin } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

const PollRequestSchema = z
  .object({
    code: z.string().min(1),
    verificationKey: z.string().min(1),
    ackApiKey: z.string().min(1).optional(),
  })
  .strict()

export async function POST(request: NextRequest) {
  const rateLimit = await checkPublicApiEndpointRateLimit(request, 'mcp-auth-poll')
  if (!rateLimit.allowed) {
    const status = rateLimit.failureKind === 'dependency' ? 503 : 429
    return NextResponse.json({ error: rateLimit.error || 'Rate limit exceeded' }, { status })
  }

  const parsed = PollRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid MCP login poll request' }, { status: 400 })
  }

  if (!isApiKeyStorageAvailable()) {
    return NextResponse.json({ error: 'API key access is not configured' }, { status: 503 })
  }

  const result =
    parsed.data.ackApiKey !== undefined
      ? await acknowledgeMcpDeviceLogin({
          apiKey: parsed.data.ackApiKey,
          code: parsed.data.code,
          verificationKey: parsed.data.verificationKey,
        })
      : await pollMcpDeviceLogin(parsed.data.code, parsed.data.verificationKey)
  return NextResponse.json(result)
}
