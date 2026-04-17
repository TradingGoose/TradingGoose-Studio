import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  authenticateApiKeyFromHeader,
  updateApiKeyLastUsed,
} from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('TaskStatusAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId: taskId } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Getting status for task: ${taskId}`)

    const session = await getSession()
    let authenticatedUserId: string | null = session?.user?.id || null

    if (!authenticatedUserId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
        if (authResult.success && authResult.userId) {
          authenticatedUserId = authResult.userId
          if (authResult.keyId) {
            await updateApiKeyLastUsed(authResult.keyId).catch((error) => {
              logger.warn(
                `[${requestId}] Failed to update API key last used timestamp:`,
                {
                  keyId: authResult.keyId,
                  error,
                },
              )
            })
          }
        }
      }
    }

    if (!authenticatedUserId) {
      return createErrorResponse('Authentication required', 401)
    }

    const [pendingRow] = await db
      .select({
        id: pendingExecution.id,
        status: pendingExecution.status,
        errorMessage: pendingExecution.errorMessage,
        createdAt: pendingExecution.createdAt,
        processingStartedAt: pendingExecution.processingStartedAt,
        result: pendingExecution.result,
        completedAt: pendingExecution.completedAt,
      })
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, taskId),
          eq(pendingExecution.userId, authenticatedUserId),
        ),
      )
      .limit(1)

    if (pendingRow) {
      return NextResponse.json({
        success: true,
        taskId,
        status:
          pendingRow.status === 'pending'
            ? 'queued'
            : pendingRow.status,
        ...(pendingRow.status === 'completed'
          ? { output: pendingRow.result }
          : pendingRow.status === 'failed'
            ? { error: pendingRow.errorMessage ?? 'Execution failed' }
          : { estimatedDuration: 180000 }),
        metadata: {
          startedAt: pendingRow.processingStartedAt ?? pendingRow.createdAt,
          ...(pendingRow.completedAt
            ? { completedAt: pendingRow.completedAt }
            : {}),
        },
      })
    }

    return createErrorResponse('Task not found', 404)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching task status:`, error)
    return createErrorResponse('Failed to fetch task status', 500)
  }
}
