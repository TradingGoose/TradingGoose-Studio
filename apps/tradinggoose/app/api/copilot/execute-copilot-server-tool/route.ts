import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { REVIEW_ENTITY_KINDS } from '@/lib/copilot/review-sessions/types'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

const logger = createLogger('ExecuteCopilotServerToolAPI')

const ExecuteSchema = z.object({
  toolName: z.string().min(1),
  payload: z.unknown().optional(),
  accessLevel: z.enum(['limited', 'full']),
  reviewAction: z.enum(['accept']).optional(),
  reviewResult: z.unknown().optional(),
  context: z
    .object({
      contextEntityKind: z.enum(REVIEW_ENTITY_KINDS).optional(),
      contextEntityId: z.string().optional(),
      workspaceId: z.string().optional(),
    })
    .optional(),
})

function readPayloadWorkspaceId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  const workspaceId = (payload as { workspaceId?: unknown }).workspaceId
  return typeof workspaceId === 'string' && workspaceId.trim().length > 0
    ? workspaceId.trim()
    : undefined
}

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  let toolName: string | undefined
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    try {
      const preview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming request body preview`, { preview })
    } catch {}

    let parsedBody: z.infer<typeof ExecuteSchema>
    try {
      parsedBody = ExecuteSchema.parse(body)
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug(`[${tracker.requestId}] Execute request envelope validation error`, {
          issues: error.issues,
        })
        return createBadRequestResponse('Invalid request body for execute-copilot-server-tool')
      }
      throw error
    }
    toolName = parsedBody.toolName
    const { payload, accessLevel, context, reviewAction, reviewResult } = parsedBody
    const payloadWorkspaceId = readPayloadWorkspaceId(payload)
    const contextWorkspaceId = context?.workspaceId?.trim()

    if (payloadWorkspaceId && contextWorkspaceId && payloadWorkspaceId !== contextWorkspaceId) {
      return createBadRequestResponse('workspaceId does not match execution context')
    }

    const executionContextInput =
      payloadWorkspaceId && !contextWorkspaceId
        ? { ...(context ?? {}), workspaceId: payloadWorkspaceId }
        : context

    const [{ isToolId }, { routeExecution }, { acceptServerManagedToolReview }] =
      await Promise.all([
        import('@/lib/copilot/registry'),
        import('@/lib/copilot/tools/server/router'),
        import('@/lib/copilot/tools/server/review-acceptance'),
      ])

    if (!isToolId(toolName)) {
      return createBadRequestResponse('Invalid request body for execute-copilot-server-tool')
    }

    logger.info(`[${tracker.requestId}] Executing server tool`, { toolName, reviewAction })
    if (executionContextInput?.workspaceId) {
      const workspaceAccess = await checkWorkspaceAccess(executionContextInput.workspaceId, userId)
      if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
        return NextResponse.json(
          { error: 'Access denied to this workspace', code: 'WORKSPACE_ACCESS_DENIED' },
          { status: 403 }
        )
      }
    }

    const executionContext = {
      userId,
      accessLevel,
      ...executionContextInput,
      signal: req.signal,
    }
    const result =
      reviewAction === 'accept'
        ? await acceptServerManagedToolReview(toolName, reviewResult, executionContext)
        : await routeExecution(toolName, payload, executionContext)

    try {
      const resultPreview = JSON.stringify(result).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Server tool result preview`, { toolName, resultPreview })
    } catch {}

    return NextResponse.json({ success: true, result })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Failed to execute server tool:`, error)
    const structuredError = buildCopilotServerToolErrorResponse(toolName, error)
    return NextResponse.json(structuredError.body, { status: structuredError.status })
  }
}
