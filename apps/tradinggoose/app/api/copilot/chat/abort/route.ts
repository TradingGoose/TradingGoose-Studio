import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotAbortAPI')

const AbortTurnSchema = z.object({
  chatId: z.string().optional(),
  conversationId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = AbortTurnSchema.parse(await req.json())
    if (!parsed.chatId && !parsed.conversationId) {
      return createBadRequestResponse('chatId or conversationId is required')
    }

    const response = await proxyCopilotRequest({
      endpoint: '/api/tools/abort-turn',
      signal: req.signal,
      body: {
        chatId: parsed.chatId,
        conversationId: parsed.conversationId,
        userId,
        workspaceId: parsed.workspaceId,
      },
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      logger.warn('Copilot service abort failed', {
        status: response.status,
        message,
      })
      return NextResponse.json({ success: false, error: message }, { status: response.status })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('Invalid request body for copilot abort')
    }

    logger.error('Failed to abort copilot turn', error)
    return createInternalServerErrorResponse('Failed to abort copilot turn')
  }
}
