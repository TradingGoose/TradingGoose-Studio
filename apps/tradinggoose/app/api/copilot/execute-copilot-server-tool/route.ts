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

const logger = createLogger('ExecuteCopilotServerToolAPI')

const ExecuteSchema = z
  .object({
    toolName: z.string().min(1),
    payload: z.unknown().optional(),
    accessLevel: z.enum(['limited', 'full']).optional(),
    reviewAction: z.enum(['accept']).optional(),
    reviewToken: z.string().optional(),
    context: z
      .object({
        contextEntityKind: z.enum(REVIEW_ENTITY_KINDS).optional(),
        contextEntityId: z.string().optional(),
        workspaceId: z.string().optional(),
      })
      .optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  let toolName: string | undefined
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
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
    const { payload, context, reviewAction, reviewToken } = parsedBody
    const contextEntityKind = context?.contextEntityKind
    const contextEntityId =
      typeof context?.contextEntityId === 'string' ? context.contextEntityId.trim() : undefined
    const contextWorkspaceId =
      typeof context?.workspaceId === 'string' ? context.workspaceId.trim() : undefined

    if (reviewAction === 'accept' && !reviewToken) {
      return createBadRequestResponse('reviewToken is required to accept a server tool review')
    }
    if (contextEntityKind === 'dashboard_layout') {
      if (contextEntityId?.includes('dashboard_layout:')) {
        return createBadRequestResponse(
          'dashboard_layout contextEntityId must be the raw layout id'
        )
      }
      if (reviewAction !== 'accept' && (!contextEntityId || !contextWorkspaceId)) {
        return createBadRequestResponse(
          'dashboard_layout context requires contextEntityId and workspaceId'
        )
      }
    }

    const [
      { isToolId },
      { routeExecution },
      { acceptServerManagedToolReview, stageServerManagedToolReview },
    ] = await Promise.all([
      import('@/lib/copilot/registry'),
      import('@/lib/copilot/tools/server/router'),
      import('@/lib/copilot/tools/server/review-acceptance'),
    ])

    if (!isToolId(toolName)) {
      return createBadRequestResponse('Invalid request body for execute-copilot-server-tool')
    }
    const toolId = toolName
    const normalizedContext = context
      ? {
          ...(contextEntityKind ? { contextEntityKind } : {}),
          ...(contextEntityId ? { contextEntityId } : {}),
          ...(contextWorkspaceId ? { workspaceId: contextWorkspaceId } : {}),
        }
      : undefined

    logger.info(`[${tracker.requestId}] Executing server tool`, { toolName: toolId, reviewAction })
    const executionContext = {
      userId,
      accessLevel:
        reviewAction === 'accept' ? ('limited' as const) : (parsedBody.accessLevel ?? 'limited'),
      ...normalizedContext,
      signal: req.signal,
    }
    const result = await (reviewAction === 'accept'
      ? acceptServerManagedToolReview(toolId, reviewToken!, executionContext)
      : routeExecution(toolId, payload, executionContext).then((toolResult) =>
          stageServerManagedToolReview(toolId, payload, toolResult, executionContext)
        ))

    return NextResponse.json({ success: true, result })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Failed to execute server tool:`, error)
    const structuredError = buildCopilotServerToolErrorResponse(toolName, error)
    return NextResponse.json(structuredError.body, { status: structuredError.status })
  }
}
