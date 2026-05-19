import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { executeFunctionRequest } from '@/lib/function/execution'
import { createLogger } from '@/lib/logs/console/logger'
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
    const auth = await checkInternalAuth(req)
    if (!auth.success || !auth.userId) {
      return respondFailure('Unauthorized', Date.now() - startTime, 401)
    }

    const body = await req.json()
    const { workflowId, workspaceId } = body

    if (
      body.usesParentExecutionConcurrencySlot !== true ||
      typeof workflowId !== 'string' ||
      typeof workspaceId !== 'string'
    ) {
      return respondFailure(
        'Function execution requires parent workflow execution context',
        Date.now() - startTime,
        400
      )
    }

    const result = await executeFunctionRequest({
      ...body,
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
