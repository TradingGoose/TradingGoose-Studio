import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createIndicators, listIndicators, saveIndicator } from '@/lib/indicators/custom/operations'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { SavedEntityPersistenceError } from '@/lib/yjs/server/apply-entity-state'
import {
  deleteYjsSessionInSocketServer,
  notifyEntityListMemberRemoved,
} from '@/lib/yjs/server/snapshot-bridge'
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
  logger.warn(
    `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
  )
}

const IndicatorSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicators: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1, 'Indicator name is required'),
      pineCode: z.string().default(''),
    })
  ),
})

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')

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
    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId for indicators fetch`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const permissionCheck = await checkWorkspacePermission({
      userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permissionCheck.ok) {
      logWorkspacePermissionDenied({
        requestId,
        userId,
        workspaceId,
        code: permissionCheck.code,
      })
      return permissionCheck.response
    }

    return NextResponse.json({ data: await listIndicators({ workspaceId }) }, { status: 200 })
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

      const indicatorsToCreate = indicators.filter((indicator) => !indicator.id)
      const indicatorsToSave = indicators.filter((indicator) => indicator.id)
      if (indicatorsToCreate.length > 0 && indicatorsToSave.length > 0) {
        return NextResponse.json(
          { error: 'Create and save indicators in separate requests' },
          { status: 400 }
        )
      }
      if (indicatorsToSave.length > 1) {
        return NextResponse.json(
          { error: 'Save one existing indicator per request' },
          { status: 400 }
        )
      }

      const resultIndicators =
        indicatorsToSave.length === 1
          ? await saveIndicator({
              indicator: {
                id: indicatorsToSave[0].id!,
                name: indicatorsToSave[0].name,
                pineCode: indicatorsToSave[0].pineCode,
              },
              workspaceId,
              requestId,
            })
          : await createIndicators({
              indicators: indicatorsToCreate,
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
      if (validationError instanceof SavedEntityPersistenceError) {
        return NextResponse.json(validationError.responseBody(), { status: validationError.status })
      }
      if (validationError instanceof Error && validationError.message.includes('was not found')) {
        return NextResponse.json({ error: validationError.message }, { status: 404 })
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

    const [existingIndicator] = await db
      .select({ id: pineIndicators.id })
      .from(pineIndicators)
      .where(and(eq(pineIndicators.id, indicatorId), eq(pineIndicators.workspaceId, workspaceId)))
      .limit(1)

    if (!existingIndicator) {
      logger.warn(`[${requestId}] Indicator not found: ${indicatorId}`)
      return NextResponse.json({ error: 'Indicator not found' }, { status: 404 })
    }

    await db
      .delete(pineIndicators)
      .where(and(eq(pineIndicators.id, indicatorId), eq(pineIndicators.workspaceId, workspaceId)))
    await deleteYjsSessionInSocketServer(indicatorId).catch(() => undefined)
    await notifyEntityListMemberRemoved('indicator', workspaceId, indicatorId)

    logger.info(`[${requestId}] Deleted indicator ${indicatorId}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting indicator`, error)
    return NextResponse.json({ error: 'Failed to delete indicator' }, { status: 500 })
  }
}
