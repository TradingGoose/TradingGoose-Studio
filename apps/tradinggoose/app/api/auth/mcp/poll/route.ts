import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pollMcpDeviceLogin } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

const PollRequestSchema = z.object({
  code: z.string().min(1),
  verificationKey: z.string().min(1),
  confirm: z.boolean().optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const parsed = PollRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid MCP login poll request' }, { status: 400 })
  }

  const result = await pollMcpDeviceLogin(parsed.data.code, parsed.data.verificationKey, {
    confirm: parsed.data.confirm === true,
    apiKey: parsed.data.apiKey,
  })
  return NextResponse.json(result)
}
