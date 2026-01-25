import { db } from '@tradinggoose/db'
import { customIndicators, workflow } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { upsertCustomIndicators } from '@/lib/indicators/custom/operations'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('CustomIndicatorsAPI')

const CustomIndicatorSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicators: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1, 'Indicator name is required'),
      color: z.string().optional(),
      calcCode: z.string().default(''),
    })
  ),
})

// GET - Fetch all custom indicators for a workspace
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')
  const workflowId = searchParams.get('workflowId')

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom indicators access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
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
      logger.warn(`[${requestId}] Missing workspaceId for custom indicators fetch`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    if (!(authResult.authType === 'internal_jwt' && workflowId)) {
      const permission = await getUserEntityPermissions(userId, 'workspace', resolvedWorkspaceId)
      if (!permission) {
        logger.warn(
          `[${requestId}] User ${userId} does not have access to workspace ${resolvedWorkspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const result = await db
      .select()
      .from(customIndicators)
      .where(eq(customIndicators.workspaceId, resolvedWorkspaceId))
      .orderBy(desc(customIndicators.createdAt))

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching custom indicators:`, error)
    return NextResponse.json({ error: 'Failed to fetch custom indicators' }, { status: 500 })
  }
}

// POST - Create or update custom indicators
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom indicators update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    try {
      const { indicators, workspaceId } = CustomIndicatorSchema.parse(body)

      const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
      if (!permission) {
        logger.warn(
          `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      if (permission !== 'admin' && permission !== 'write') {
        logger.warn(
          `[${requestId}] User ${authResult.userId} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      const resultIndicators = await upsertCustomIndicators({
        indicators,
        workspaceId,
        userId: authResult.userId,
        requestId,
      })

      return NextResponse.json({ success: true, data: resultIndicators })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid custom indicators data`, {
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
    logger.error(`[${requestId}] Error updating custom indicators`, error)
    return NextResponse.json({ error: 'Failed to update custom indicators' }, { status: 500 })
  }
}

// DELETE - Delete a custom indicator by ID
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
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom indicator deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (!permission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    await db
      .delete(customIndicators)
      .where(and(eq(customIndicators.id, indicatorId), eq(customIndicators.workspaceId, workspaceId)))

    logger.info(`[${requestId}] Deleted custom indicator ${indicatorId}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting custom indicator`, error)
    return NextResponse.json({ error: 'Failed to delete custom indicator' }, { status: 500 })
  }
}
