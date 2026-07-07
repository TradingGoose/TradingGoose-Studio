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
        ownerUserId: z.string().optional(),
      })
      .optional(),
  })
  .strict()

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
    const contextOwnerUserId =
      typeof context?.ownerUserId === 'string' ? context.ownerUserId.trim() : undefined

    if (reviewAction === 'accept' && !reviewToken) {
      return createBadRequestResponse('reviewToken is required to accept a server tool review')
    }
    if (contextOwnerUserId && contextEntityKind !== 'dashboard_layout') {
      return createBadRequestResponse('ownerUserId is only valid for dashboard_layout context')
    }
    if (contextEntityKind === 'dashboard_layout') {
      if (contextEntityId?.includes('dashboard_layout:')) {
        return createBadRequestResponse(
          'dashboard_layout contextEntityId must be the raw layout id'
        )
      }
      if (contextOwnerUserId && contextOwnerUserId !== userId) {
        return createBadRequestResponse(
          'dashboard_layout context requires authenticated ownerUserId'
        )
      }
      if (
        reviewAction !== 'accept' &&
        (!contextEntityId || !contextWorkspaceId || !contextOwnerUserId)
      ) {
        return createBadRequestResponse(
          'dashboard_layout context requires contextEntityId, workspaceId, and authenticated ownerUserId'
        )
      }
    }

    const [
      { isToolId },
      { isWorkspaceAgnosticServerTool, routeExecution },
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
    const isWorkspaceAgnosticTool = isWorkspaceAgnosticServerTool(toolId)
    const payloadWorkspaceId = readPayloadWorkspaceId(payload)
    const normalizedContext = context
      ? {
          ...(contextEntityKind ? { contextEntityKind } : {}),
          ...(contextEntityId ? { contextEntityId } : {}),
          ...(contextWorkspaceId ? { workspaceId: contextWorkspaceId } : {}),
          ...(reviewAction !== 'accept' && contextOwnerUserId
            ? { ownerUserId: contextOwnerUserId }
            : {}),
        }
      : undefined

    if (
      !isWorkspaceAgnosticTool &&
      payloadWorkspaceId &&
      contextWorkspaceId &&
      payloadWorkspaceId !== contextWorkspaceId
    ) {
      return createBadRequestResponse('workspaceId does not match execution context')
    }

    const executionContextInput = isWorkspaceAgnosticTool
      ? undefined
      : payloadWorkspaceId && !contextWorkspaceId
        ? { ...(normalizedContext ?? {}), workspaceId: payloadWorkspaceId }
        : normalizedContext

    logger.info(`[${tracker.requestId}] Executing server tool`, { toolName: toolId, reviewAction })
    if (!isWorkspaceAgnosticTool && executionContextInput?.workspaceId) {
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
      accessLevel:
        reviewAction === 'accept' ? ('limited' as const) : (parsedBody.accessLevel ?? 'limited'),
      ...executionContextInput,
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
