import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import {
  loadReviewSessionForUser,
  loadReviewSessionForUserByConversationId,
} from '@/lib/copilot/review-sessions/permissions'
import { COPILOT_SESSION_KIND } from '@/lib/copilot/session-scope'
import { createLogger } from '@/lib/logs/console/logger'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotAbortAPI')

const AbortTurnSchema = z.object({
  chatId: z.string().optional(),
  conversationId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
})

type AbortTurnRequest = z.infer<typeof AbortTurnSchema>

function normalizeOptionalId(value: string | null | undefined): string | null {
  return value?.trim() || null
}

async function loadAbortSession(parsed: AbortTurnRequest, userId: string) {
  const chatId = normalizeOptionalId(parsed.chatId)
  const conversationId = normalizeOptionalId(parsed.conversationId)
  const workspaceId = normalizeOptionalId(parsed.workspaceId)

  const session = chatId
    ? await loadReviewSessionForUser(chatId, userId, 'read')
    : conversationId
      ? await loadReviewSessionForUserByConversationId(conversationId, COPILOT_SESSION_KIND, userId, 'read')
      : null

  if (!session || session.entityKind !== COPILOT_SESSION_KIND) {
    return null
  }

  if (conversationId && session.conversationId && session.conversationId !== conversationId) {
    return null
  }

  if (parsed.workspaceId !== undefined && (session.workspaceId ?? null) !== workspaceId) {
    return null
  }

  return {
    session,
    conversationId: session.conversationId ?? null,
  }
}

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

    const abortSession = await loadAbortSession(parsed, userId)
    if (!abortSession) {
      return createNotFoundResponse('Copilot chat not found or unauthorized')
    }

    const { session, conversationId } = abortSession
    const response = await proxyCopilotRequest({
      endpoint: '/api/tools/abort-turn',
      signal: req.signal,
      body: {
        chatId: session.id,
        conversationId: conversationId ?? undefined,
        userId,
        workspaceId: session.workspaceId ?? undefined,
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
