import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'

const BodySchema = z.object({
  messageId: z.string(),
  diffCreated: z.boolean(),
  diffAccepted: z.boolean(),
})

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const json = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return createBadRequestResponse('Invalid request body for copilot stats')
    }

    const { messageId, diffCreated, diffAccepted } = parsed.data as any

    // Build outgoing payload for TradingGoose Agent with only required fields
    const payload: Record<string, any> = {
      messageId,
      diffCreated,
      diffAccepted,
    }

    const agentRes = await proxyCopilotRequest({
      endpoint: '/api/stats',
      body: payload,
    })

    // Prefer not to block clients; still relay status
    let agentJson: any = null
    try {
      agentJson = await agentRes.json()
    } catch { }

    if (!agentRes.ok) {
      const message = (agentJson && (agentJson.error || agentJson.message)) || 'Upstream error'
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return createInternalServerErrorResponse('Failed to forward copilot stats')
  }
}
