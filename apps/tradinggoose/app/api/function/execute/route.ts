import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  ExecutionGateError,
  enforceServerExecutionRateLimit,
} from '@/lib/execution/execution-concurrency-limit'
import {
  executeFunctionRequest,
} from '@/lib/function/execution'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess, getUserEntityPermissions } from '@/lib/permissions/utils'
import { RateLimitError } from '@/services/queue'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 210

const logger = createLogger('FunctionExecuteAPI')

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const buildOutput = (result: unknown, executionTime: number, outputStdout = '') => ({
    result,
    stdout: outputStdout,
    executionTime,
  })
  const respondFailure = (
    error: string,
    executionTime: number,
    status = 500,
    outputStdout = '',
    debug?: Record<string, unknown>
  ) =>
    NextResponse.json(
      {
        success: false,
        error,
        output: buildOutput(null, executionTime, outputStdout),
        ...(debug ? { debug } : {}),
      },
      { status }
    )

  try {
    const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return respondFailure('Unauthorized', Date.now() - startTime, 401)
    }

    const body = await req.json()
    const { workflowId, workspaceId } = body
    const concurrencyLeaseInherited =
      auth.authType === AuthType.INTERNAL_JWT && body.concurrencyLeaseInherited === true

    if (workflowId) {
      const [workflowData] = await db
        .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowData) {
        return respondFailure('Workflow not found', Date.now() - startTime, 404)
      }

      let hasWorkflowAccess = workflowData.userId === auth.userId

      if (!hasWorkflowAccess && workflowData.workspaceId) {
        const workflowWorkspaceAccess = await checkWorkspaceAccess(
          workflowData.workspaceId,
          auth.userId
        )
        hasWorkflowAccess = workflowWorkspaceAccess.hasAccess
      }

      if (!hasWorkflowAccess) {
        return respondFailure('Workflow access denied', Date.now() - startTime, 403)
      }
    }

    if (workspaceId) {
      const workspacePermission = await getUserEntityPermissions(
        auth.userId,
        'workspace',
        workspaceId
      )

      if (!workspacePermission) {
        return respondFailure('Workspace access denied', Date.now() - startTime, 403)
      }
    }

    await enforceServerExecutionRateLimit({
      actorUserId: auth.userId,
      authType: auth.authType,
      workflowId,
      workspaceId,
      isAsync: false,
      logger,
      requestId,
      source: 'function execution',
    })

    const result = await executeFunctionRequest({
      ...body,
      concurrencyLeaseInherited,
      userId: auth.userId,
      requestId,
    })

    return NextResponse.json(result.body, { status: result.statusCode })
  } catch (error: any) {
    if (
      error instanceof ExecutionGateError ||
      error instanceof RateLimitError
    ) {
      return respondFailure(error.message, Date.now() - startTime, error.statusCode)
    }

    logger.error(`[${requestId}] Function execution failed`, {
      error: error.message || 'Unknown error',
      stack: error.stack,
      executionTime: Date.now() - startTime,
    })

    return respondFailure(error.message || 'Function execution failed', Date.now() - startTime, 500)
  }
}
