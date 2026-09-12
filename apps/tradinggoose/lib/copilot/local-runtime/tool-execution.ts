import {
  type CopilotServerToolErrorDetails,
  getCopilotServerToolErrorDetails,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('LocalCopilotToolExecution')

export interface LocalCopilotToolResult {
  success: boolean
  result?: unknown
  errorMessage?: string
  errorStatus?: number
  errorDetails?: CopilotServerToolErrorDetails
  /** Present when the mutation was staged for review and needs user approval. */
  review?: { reviewToken: string; preview?: unknown }
}

export interface LocalCopilotToolExecutionContext {
  userId: string
  accessLevel?: 'limited' | 'full'
  contextEntityKind?: string
  contextEntityId?: string
  workspaceId?: string
  signal?: AbortSignal
}

/**
 * Executes a server-side Copilot tool from the local runtime, reusing the same
 * execution + review-staging path as the `/api/copilot/execute-copilot-server-tool`
 * route so behavior (review staging, tokens, workspace context) matches.
 *
 * `accepting`/`reviewToken` are used when the client reports it approved a
 * previously-staged mutation; otherwise the tool runs (and may stage a review).
 */
export async function executeLocalCopilotServerTool(params: {
  toolName: string
  payload?: unknown
  context?: LocalCopilotToolExecutionContext
  accepting?: boolean
  reviewToken?: string
}): Promise<LocalCopilotToolResult> {
  const { toolName, payload, context } = params
  const { userId } = context ?? {}

  if (!userId) {
    return { success: false, errorMessage: 'Authenticated user is required' }
  }

  const { isToolId } = await import('@/lib/copilot/registry')
  if (!isToolId(toolName)) {
    return { success: false, errorMessage: `Unknown server tool: ${toolName}` }
  }
  const toolId = toolName as never

  const { routeExecution } = await import('@/lib/copilot/tools/server/router')
  const {
    acceptServerManagedToolReview,
    stageServerManagedToolReview,
  } = await import('@/lib/copilot/tools/server/review-acceptance')

  const executionContext = {
    userId,
    accessLevel: (context?.accessLevel ?? 'limited') as 'limited' | 'full',
    ...(context?.contextEntityKind ? { contextEntityKind: context.contextEntityKind as never } : {}),
    ...(context?.contextEntityId ? { contextEntityId: context.contextEntityId } : {}),
    ...(context?.workspaceId ? { workspaceId: context.workspaceId } : {}),
    signal: context?.signal,
  }

  try {
    let result: unknown
    if (params.accepting && params.reviewToken) {
      result = await acceptServerManagedToolReview(toolId, params.reviewToken, executionContext)
    } else {
      const executed = await routeExecution(toolName, payload, executionContext)
      result = await stageServerManagedToolReview(toolId, payload, executed, executionContext)
    }

    const maybeReview = result as
      | { requiresReview?: boolean; reviewToken?: string; reviewBaseStateHash?: unknown }
      | null
    if (maybeReview && maybeReview.requiresReview === true && maybeReview.reviewToken) {
      const { requiresReview: _r, reviewToken, reviewBaseStateHash: _h, ...rest } =
        maybeReview as Record<string, unknown> & {
          requiresReview?: boolean
          reviewToken?: string
          reviewBaseStateHash?: unknown
        }
      return {
        success: true,
        result: rest,
        review: { reviewToken, preview: rest },
      }
    }

    return { success: true, result }
  } catch (error) {
    const errorDetails = getCopilotServerToolErrorDetails(error)
    const errorStatus = getCopilotServerToolErrorStatus(error)
    const errorMessage = error instanceof Error ? error.message : 'Tool execution failed'
    logger.warn('Local copilot server tool failed', {
      toolName,
      status: errorStatus,
      errorMessage,
      hasDetails: !!errorDetails,
    })
    return { success: false, errorMessage, errorStatus, errorDetails }
  }
}
