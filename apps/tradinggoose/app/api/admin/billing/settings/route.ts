import { db } from '@tradinggoose/db'
import { systemBillingSettings } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { requireAdminBillingUserId } from '@/lib/admin/billing/authorization'
import { adminBillingSettingsMutationSchema } from '@/lib/admin/billing/settings-mutations'
import {
  ADMIN_BILLING_UNAVAILABLE_ERROR,
  getBillingGateState,
  GLOBAL_BILLING_SETTINGS_ID,
} from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AdminBillingSettingsAPI')

function toDecimalString(value: number) {
  return value.toString()
}

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  try {
    const userId = await requireAdminBillingUserId()
    const { stripeConfigured } = await getBillingGateState()
    if (!stripeConfigured) {
      return NextResponse.json(
        { error: ADMIN_BILLING_UNAVAILABLE_ERROR },
        { status: 409 }
      )
    }
    const body = await request.json()
    const parsed = adminBillingSettingsMutationSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid billing settings payload' },
        { status: 400 }
      )
    }

    const values = {
      onboardingAllowanceUsd: toDecimalString(parsed.data.onboardingAllowanceUsd),
      overageThresholdDollars: toDecimalString(parsed.data.overageThresholdDollars),
      workflowExecutionChargeUsd: toDecimalString(parsed.data.workflowExecutionChargeUsd),
      functionExecutionChargeUsd: toDecimalString(parsed.data.functionExecutionChargeUsd),
      usageWarningThresholdPercent: parsed.data.usageWarningThresholdPercent,
      freeTierUpgradeThresholdPercent: parsed.data.freeTierUpgradeThresholdPercent,
      enterpriseContactUrl: parsed.data.enterpriseContactUrl,
      updatedByUserId: userId,
      updatedAt: new Date(),
    }

    const existing = await db
      .select({ id: systemBillingSettings.id })
      .from(systemBillingSettings)
      .where(eq(systemBillingSettings.id, GLOBAL_BILLING_SETTINGS_ID))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(systemBillingSettings)
        .set(values)
        .where(eq(systemBillingSettings.id, GLOBAL_BILLING_SETTINGS_ID))
    } else {
      await db.insert(systemBillingSettings).values({
        id: GLOBAL_BILLING_SETTINGS_ID,
        ...values,
      })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    logger.error('Failed to update billing settings', { error })
    return NextResponse.json({ error: 'Failed to update billing settings' }, { status: 500 })
  }
}
