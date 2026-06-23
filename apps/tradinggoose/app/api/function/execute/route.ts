import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { executeFunctionRequest } from '@/lib/function/execution'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { readWorkflowById } from '@/lib/workflows/utils'

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
    const auth = await checkInternalAuth(req)
    if (!auth.success || !auth.userId) {
      return respondFailure('Unauthorized', Date.now() - startTime, 401)
    }

    const body = await req.json()
    const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : ''
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''

    if (!workflowId && !workspaceId) {
      return respondFailure(
        'Function execution requires workflow or workspace context',
        Date.now() - startTime,
        400
      )
    }
    if (workflowId && workspaceId) {
      return respondFailure(
        'Function execution accepts either workflow or workspace context, not both',
        Date.now() - startTime,
        400
      )
    }

    const workflow = workflowId ? await readWorkflowById(workflowId) : null
    if (workflowId && !workflow?.workspaceId) {
      return respondFailure('Workflow not found', Date.now() - startTime, 404)
    }

    const executionWorkspaceId = workflow?.workspaceId ?? workspaceId
    const access = await checkWorkspaceAccess(executionWorkspaceId, auth.userId)
    if (!access.hasAccess) {
      return respondFailure('Access denied', Date.now() - startTime, 403)
    }

    const result = await executeFunctionRequest({
      ...body,
      workflowId: workflow?.id,
      workspaceId: executionWorkspaceId,
      userId: auth.userId,
      requestId,
    })

    return NextResponse.json(result.body, { status: result.statusCode })
  } catch (error: any) {
    logger.error(`[${requestId}] Function execution failed`, {
      error: error.message || 'Unknown error',
      stack: error.stack,
      executionTime: Date.now() - startTime,
    })

    return respondFailure(error.message || 'Function execution failed', Date.now() - startTime, 500)
  }
}
