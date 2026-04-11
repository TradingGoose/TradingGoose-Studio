import { db } from '@tradinggoose/db'
import { userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getOrganizationBillingLedger } from '@/lib/billing/core/organization'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('BillingUpdateCostAPI')

const UpdateCostSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  workflowId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  cost: z.number().min(0, 'Cost must be a non-negative number'),
})

/**
 * POST /api/billing/update-cost
 * Update user cost with a pre-calculated cost value (internal API key auth required)
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Update cost request started`)

    if (!(await isBillingEnabledForRuntime())) {
      logger.debug(`[${requestId}] Billing is disabled, skipping cost update`)
      return NextResponse.json({
        success: true,
        message: 'Billing disabled, cost update skipped',
        data: {
          billingEnabled: false,
          processedAt: new Date().toISOString(),
          requestId,
        },
      })
    }

    // Check authentication (internal API key)
    const authResult = checkInternalApiKey(req)
    if (!authResult.success) {
      logger.warn(`[${requestId}] Authentication failed: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication failed',
        },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await req.json()
    const validation = UpdateCostSchema.safeParse(body)

    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid request body`, {
        errors: validation.error.issues,
        body,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const { userId, workflowId, workspaceId, cost } = validation.data

    const billingContext = workflowId
      ? await resolveWorkflowBillingContext({ workflowId, actorUserId: userId })
      : workspaceId
        ? await resolveWorkspaceBillingContext({ workspaceId, actorUserId: userId })
        : null
    const billingScopeType = billingContext?.scopeType ?? 'user'
    const billingScopeId = billingContext?.scopeId ?? userId
    const billingUserId = billingContext?.billingUserId ?? userId

    logger.info(`[${requestId}] Processing cost update`, {
      userId,
      workflowId,
      workspaceId,
      billingScopeType,
      billingScopeId,
      billingUserId,
      cost,
    })

    if (billingScopeType === 'organization') {
      const billingLedger = await getOrganizationBillingLedger(billingScopeId)
      if (!billingLedger) {
        logger.error(
          `[${requestId}] Organization billing ledger record not found - should be created during onboarding`,
          {
            userId,
            workflowId,
            workspaceId,
            billingScopeId,
          }
        )
        return NextResponse.json({ error: 'Billing ledger record not found' }, { status: 500 })
      }
    } else {
      // Check if the billing ledger row exists (same as ExecutionLogger)
      const userStatsRecords = await db
        .select()
        .from(userStats)
        .where(eq(userStats.userId, billingUserId))

      if (userStatsRecords.length === 0) {
        logger.error(
          `[${requestId}] User stats record not found - should be created during onboarding`,
          {
            userId,
            workflowId,
            workspaceId,
            billingUserId,
          }
        )
        return NextResponse.json({ error: 'User stats record not found' }, { status: 500 })
      }
    }
    // Update the active billing ledger record
    await accrueUserUsageCost({
      userId,
      workflowId,
      workspaceId,
      cost,
      reason: 'internal_update_cost',
    })

    logger.info(`[${requestId}] Updated billing ledger record`, {
      userId,
      workflowId,
      workspaceId,
      billingScopeType,
      billingScopeId,
      billingUserId,
      addedCost: cost,
    })

    const duration = Date.now() - startTime

    logger.info(`[${requestId}] Cost update completed successfully`, {
      userId,
      duration,
      cost,
    })

    return NextResponse.json({
      success: true,
      data: {
        userId,
        billingUserId,
        billingScopeType,
        billingScopeId,
        workflowId,
        workspaceId,
        cost,
        processedAt: new Date().toISOString(),
        requestId,
      },
    })
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error(`[${requestId}] Cost update failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        requestId,
      },
      { status: 500 }
    )
  }
}
