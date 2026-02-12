import { db } from '@tradinggoose/db'
import { pineIndicators, workflow } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { upsertIndicators } from '@/lib/indicators/custom/operations'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '../utils'

const logger = createLogger('IndicatorsAPI')

const logWorkspacePermissionDenied = ({
  requestId,
  userId,
  workspaceId,
  code,
}: {
  requestId: string
  userId: string
  workspaceId: string
  code: 'access_denied' | 'write_permission_required'
}) => {
  if (code === 'access_denied') {
    logger.warn(`[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`)
    return
  }
  logger.warn(`[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`)
}

const IndicatorSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicators: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1, 'Indicator name is required'),
      color: z.string().optional(),
      pineCode: z.string().default(''),
      inputMeta: z.record(z.any()).optional(),
    })
  ),
})

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')
  const workflowId = searchParams.get('workflowId')

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'access',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const userId = auth.userId
    let resolvedWorkspaceId: string | null = workspaceId

    if (!resolvedWorkspaceId && workflowId) {
      const [workflowData] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowData?.workspaceId) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      resolvedWorkspaceId = workflowData.workspaceId
    }

    if (!resolvedWorkspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId for indicators fetch`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    if (!(auth.authType === 'internal_jwt' && workflowId)) {
      const permissionCheck = await checkWorkspacePermission({
        userId,
        workspaceId: resolvedWorkspaceId,
        responseShape: 'errorOnly',
      })
      if (!permissionCheck.ok) {
        logWorkspacePermissionDenied({
          requestId,
          userId,
          workspaceId: resolvedWorkspaceId,
          code: permissionCheck.code,
        })
        return permissionCheck.response
      }
    }

    const result = await db
      .select()
      .from(pineIndicators)
      .where(eq(pineIndicators.workspaceId, resolvedWorkspaceId))
      .orderBy(desc(pineIndicators.createdAt))

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching indicators:`, error)
    return NextResponse.json({ error: 'Failed to fetch indicators' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'update',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const body = await request.json()

    try {
      const { indicators, workspaceId } = IndicatorSchema.parse(body)

      const permissionCheck = await checkWorkspacePermission({
        userId: auth.userId,
        workspaceId,
        requireWrite: true,
        responseShape: 'errorOnly',
      })
      if (!permissionCheck.ok) {
        logWorkspacePermissionDenied({
          requestId,
          userId: auth.userId,
          workspaceId,
          code: permissionCheck.code,
        })
        return permissionCheck.response
      }

      const resultIndicators = await upsertIndicators({
        indicators,
        workspaceId,
        userId: auth.userId,
        requestId,
      })

      return NextResponse.json({ success: true, data: resultIndicators })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid indicators data`, {
          errors: validationError.errors,
        })

        const workspaceError = validationError.errors.find(
          (err) => err.path.length === 1 && err.path[0] === 'workspaceId'
        )
        if (workspaceError) {
          return NextResponse.json({ error: workspaceError.message }, { status: 400 })
        }

        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating indicators`, error)
    return NextResponse.json({ error: 'Failed to update indicators' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const indicatorId = searchParams.get('id')
  const workspaceId = searchParams.get('workspaceId')

  if (!indicatorId) {
    logger.warn(`[${requestId}] Missing indicator ID for deletion`)
    return NextResponse.json({ error: 'Indicator ID is required' }, { status: 400 })
  }
  if (!workspaceId) {
    logger.warn(`[${requestId}] Missing workspaceId for deletion`)
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'deletion',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const permissionCheck = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permissionCheck.ok) {
      logWorkspacePermissionDenied({
        requestId,
        userId: auth.userId,
        workspaceId,
        code: permissionCheck.code,
      })
      return permissionCheck.response
    }

    await db
      .delete(pineIndicators)
      .where(and(eq(pineIndicators.id, indicatorId), eq(pineIndicators.workspaceId, workspaceId)))

    logger.info(`[${requestId}] Deleted indicator ${indicatorId}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting indicator`, error)
    return NextResponse.json({ error: 'Failed to delete indicator' }, { status: 500 })
  }
}
