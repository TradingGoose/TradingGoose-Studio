import { db } from '@tradinggoose/db'
import { systemBillingTier } from '@tradinggoose/db/schema'
import { NextResponse } from 'next/server'
import { requireAdminBillingUserId } from '@/lib/admin/billing/authorization'
import {
  adminBillingTierMutationSchema,
  validateAdminBillingTierInput,
} from '@/lib/admin/billing/tier-mutations'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AdminBillingTierCreateAPI')

function toDecimalString(value: number | null) {
  return value === null ? null : value.toString()
}

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const userId = await requireAdminBillingUserId()
    const body = await request.json()
    const parsed = adminBillingTierMutationSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid billing tier payload' },
        { status: 400 }
      )
    }

    const validationError = validateAdminBillingTierInput(parsed.data)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    if (
      (await isBillingEnabledForRuntime()) &&
      parsed.data.isDefault &&
      parsed.data.status !== 'active'
    ) {
      return NextResponse.json(
        { error: 'The default tier must stay active while billing is enabled.' },
        { status: 409 }
      )
    }

    const tierId = `tier_${crypto.randomUUID()}`

    await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.update(systemBillingTier).set({ isDefault: false })
      }
      await tx.insert(systemBillingTier).values({
        id: tierId,
        displayName: parsed.data.displayName,
        description: parsed.data.description,
        status: parsed.data.status,
        ownerType: parsed.data.ownerType,
        usageScope: parsed.data.usageScope,
        seatMode: parsed.data.seatMode,
        monthlyPriceUsd: toDecimalString(parsed.data.monthlyPriceUsd),
        yearlyPriceUsd: toDecimalString(parsed.data.yearlyPriceUsd),
        includedUsageLimitUsd: toDecimalString(parsed.data.includedUsageLimitUsd),
        storageLimitGb: parsed.data.storageLimitGb,
        concurrencyLimit: parsed.data.concurrencyLimit,
        seatCount: parsed.data.seatCount,
        seatMaximum: parsed.data.seatMaximum,
        stripeMonthlyPriceId: parsed.data.stripeMonthlyPriceId,
        stripeYearlyPriceId: parsed.data.stripeYearlyPriceId,
        stripeProductId: parsed.data.stripeProductId,
        syncRateLimitPerMinute: parsed.data.syncRateLimitPerMinute,
        asyncRateLimitPerMinute: parsed.data.asyncRateLimitPerMinute,
        apiEndpointRateLimitPerMinute: parsed.data.apiEndpointRateLimitPerMinute,
        canEditUsageLimit: parsed.data.canEditUsageLimit,
        canConfigureSso: parsed.data.canConfigureSso,
        logRetentionDays: parsed.data.logRetentionDays,
        workflowModelCostMultiplier: String(parsed.data.workflowModelCostMultiplier ?? 1),
        functionExecutionDurationMultiplier: String(
          parsed.data.functionExecutionDurationMultiplier ?? 0
        ),
        copilotCostMultiplier: String(parsed.data.copilotCostMultiplier ?? 1),
        pricingFeatures: parsed.data.pricingFeatures,
        isPublic: parsed.data.isPublic,
        isDefault: parsed.data.isDefault,
        displayOrder: parsed.data.displayOrder,
        updatedByUserId: userId,
        updatedAt: new Date(),
      })
    })

    return NextResponse.json({ success: true, id: tierId }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    logger.error('Failed to create billing tier', { error })
    return NextResponse.json({ error: 'Failed to create billing tier' }, { status: 500 })
  }
}
