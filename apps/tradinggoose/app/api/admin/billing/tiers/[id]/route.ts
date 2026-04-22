import { db } from '@tradinggoose/db'
import { subscription, systemBillingTier } from '@tradinggoose/db/schema'
import { count, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { requireAdminBillingUserId } from '@/lib/admin/billing/authorization'
import {
  adminBillingTierMutationSchema,
  validateAdminBillingTierInput,
} from '@/lib/admin/billing/tier-mutations'
import {
  ADMIN_BILLING_UNAVAILABLE_ERROR,
  getBillingGateState,
  isBillingEnabledForRuntime,
} from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AdminBillingTierMutationAPI')

function toDecimalString(value: number | null) {
  return value === null ? null : value.toString()
}

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAdminBillingUserId()
    const { stripeConfigured } = await getBillingGateState()
    if (!stripeConfigured) {
      return NextResponse.json({ error: ADMIN_BILLING_UNAVAILABLE_ERROR }, { status: 409 })
    }
    const { id } = await params
    const body = await request.json()
    const parsed = adminBillingTierMutationSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? 'Invalid billing tier payload',
        },
        { status: 400 }
      )
    }

    const validationError = validateAdminBillingTierInput(parsed.data)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const [existingTier] = await db
      .select()
      .from(systemBillingTier)
      .where(eq(systemBillingTier.id, id))
      .limit(1)

    if (!existingTier) {
      return NextResponse.json({ error: 'Billing tier not found' }, { status: 404 })
    }

    const billingEnabled = await isBillingEnabledForRuntime()
    if (billingEnabled && existingTier.isDefault && !parsed.data.isDefault) {
      return NextResponse.json(
        {
          error:
            'Disable billing or assign another active default tier before removing the default tier flag.',
        },
        { status: 409 }
      )
    }

    if (billingEnabled && parsed.data.isDefault && parsed.data.status !== 'active') {
      return NextResponse.json(
        {
          error: 'The default tier must stay active while billing is enabled.',
        },
        { status: 409 }
      )
    }

    const [{ count: subscriptionCount }] = await db
      .select({ count: count() })
      .from(subscription)
      .where(eq(subscription.billingTierId, id))

    const referencedSubscriptionCount = Number(subscriptionCount)

    if (referencedSubscriptionCount > 0) {
      if (parsed.data.status === 'draft') {
        return NextResponse.json(
          {
            error:
              'A tier with subscriptions cannot be moved back to draft. Archive it or keep it active.',
          },
          { status: 409 }
        )
      }

      const structuralFields: Array<keyof typeof existingTier> = [
        'ownerType',
        'usageScope',
        'seatMode',
        'stripeMonthlyPriceId',
        'stripeYearlyPriceId',
        'stripeProductId',
      ]

      const changedField = structuralFields.find(
        (field) => existingTier[field] !== (parsed.data as any)[field]
      )
      if (changedField) {
        return NextResponse.json(
          {
            error: `Cannot change ${changedField} for a tier that already has subscriptions. Duplicate the tier, migrate subscribers, and archive the old tier instead.`,
          },
          { status: 409 }
        )
      }

      if (
        parsed.data.syncRateLimitPerMinute === null ||
        parsed.data.asyncRateLimitPerMinute === null ||
        parsed.data.apiEndpointRateLimitPerMinute === null
      ) {
        return NextResponse.json(
          {
            error: 'A tier with subscriptions must keep explicit rate limits configured.',
          },
          { status: 409 }
        )
      }

      if (parsed.data.includedUsageLimitUsd === null) {
        return NextResponse.json(
          {
            error: 'A tier with subscriptions must keep an included usage limit configured.',
          },
          { status: 409 }
        )
      }

      if (parsed.data.storageLimitGb === null) {
        return NextResponse.json(
          {
            error: 'A tier with subscriptions must keep a storage limit configured.',
          },
          { status: 409 }
        )
      }

      if (parsed.data.concurrencyLimit === null) {
        return NextResponse.json(
          {
            error: 'A tier with subscriptions must keep an execution concurrency limit configured.',
          },
          { status: 409 }
        )
      }

      const zeroedExecutionMultipliers = [
        parsed.data.workflowExecutionMultiplier === 0 ? 'workflow execution multiplier' : null,
        parsed.data.functionExecutionMultiplier === 0 ? 'function execution multiplier' : null,
      ].filter((value): value is string => Boolean(value))

      if (zeroedExecutionMultipliers.length > 0) {
        return NextResponse.json(
          {
            error: `A tier with subscriptions cannot set ${zeroedExecutionMultipliers.join(' or ')} to 0. Create a separate free tier if you need zero-cost executions.`,
          },
          { status: 409 }
        )
      }
    }

    await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.update(systemBillingTier).set({ isDefault: false })
      }

      await tx
        .update(systemBillingTier)
        .set({
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
          maxPendingAgeSeconds: parsed.data.maxPendingAgeSeconds,
          maxPendingCount: parsed.data.maxPendingCount,
          canEditUsageLimit: parsed.data.canEditUsageLimit,
          canConfigureSso: parsed.data.canConfigureSso,
          logRetentionDays: parsed.data.logRetentionDays,
          workflowExecutionMultiplier: String(parsed.data.workflowExecutionMultiplier ?? 1),
          workflowModelCostMultiplier: String(parsed.data.workflowModelCostMultiplier ?? 1),
          functionExecutionMultiplier: String(parsed.data.functionExecutionMultiplier ?? 1),
          copilotCostMultiplier: String(parsed.data.copilotCostMultiplier ?? 1),
          pricingFeatures: parsed.data.pricingFeatures,
          isPublic: parsed.data.isPublic,
          isDefault: parsed.data.isDefault,
          displayOrder: parsed.data.displayOrder,
          updatedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(systemBillingTier.id, id))
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    logger.error('Failed to update billing tier', { error })
    return NextResponse.json({ error: 'Failed to update billing tier' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminBillingUserId()
    const { stripeConfigured } = await getBillingGateState()
    if (!stripeConfigured) {
      return NextResponse.json({ error: ADMIN_BILLING_UNAVAILABLE_ERROR }, { status: 409 })
    }
    const { id } = await params

    const [existingTier] = await db
      .select({
        id: systemBillingTier.id,
        isDefault: systemBillingTier.isDefault,
      })
      .from(systemBillingTier)
      .where(eq(systemBillingTier.id, id))
      .limit(1)

    if (!existingTier) {
      return NextResponse.json({ error: 'Billing tier not found' }, { status: 404 })
    }

    if (existingTier.isDefault) {
      return NextResponse.json({ error: 'The default tier cannot be deleted' }, { status: 409 })
    }

    const [{ count: subscriptionCount }] = await db
      .select({ count: count() })
      .from(subscription)
      .where(eq(subscription.billingTierId, id))

    if (Number(subscriptionCount) > 0) {
      return NextResponse.json(
        {
          error: 'This tier has subscriptions and cannot be deleted. Archive it instead.',
        },
        { status: 409 }
      )
    }

    await db.delete(systemBillingTier).where(eq(systemBillingTier.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    logger.error('Failed to delete billing tier', { error })
    return NextResponse.json({ error: 'Failed to delete billing tier' }, { status: 500 })
  }
}
