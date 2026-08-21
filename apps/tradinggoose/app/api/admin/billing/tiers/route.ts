import { db } from '@tradinggoose/db'
import { systemBillingTier } from '@tradinggoose/db/schema'
import { NextResponse } from 'next/server'
import { isPrivateTierAccessCodeConflict } from '@/lib/admin/billing/access-code'
import { requireAdminBillingUserId } from '@/lib/admin/billing/authorization'
import {
  isBillingTierStripeIdentifierError,
  validateBillingTierStripeCatalog,
  validateBillingTierStripeMutation,
} from '@/lib/admin/billing/stripe-identifiers'
import {
  adminBillingTierMutationSchema,
  toBillingTierMutationValues,
  validateAdminBillingTierInput,
} from '@/lib/admin/billing/tier-mutations'
import {
  ADMIN_BILLING_UNAVAILABLE_ERROR,
  getBillingGateState,
  isBillingEnabledForRuntime,
} from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AdminBillingTierCreateAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const userId = await requireAdminBillingUserId()
    const { stripeConfigured } = await getBillingGateState()
    if (!stripeConfigured) {
      return NextResponse.json({ error: ADMIN_BILLING_UNAVAILABLE_ERROR }, { status: 409 })
    }
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

    const validationError = validateAdminBillingTierInput(parsed.data, {
      requireStripeMonthlyPriceId: true,
    })
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    if (
      (await isBillingEnabledForRuntime()) &&
      parsed.data.isDefault &&
      parsed.data.status !== 'active'
    ) {
      return NextResponse.json(
        {
          error: 'The default tier must stay active while billing is enabled.',
        },
        { status: 409 }
      )
    }

    const tierId = `tier_${crypto.randomUUID()}`
    const catalogRevision = await validateBillingTierStripeCatalog({ id: tierId, ...parsed.data })
    await db.transaction(async (tx) => {
      await validateBillingTierStripeMutation(tx, { id: tierId, ...parsed.data }, catalogRevision)

      if (parsed.data.isDefault) {
        await tx.update(systemBillingTier).set({ isDefault: false })
      }
      await tx.insert(systemBillingTier).values({
        id: tierId,
        ...toBillingTierMutationValues(parsed.data, userId),
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

    if (isPrivateTierAccessCodeConflict(error)) {
      return NextResponse.json(
        { error: 'Private tier access code is already in use' },
        { status: 409 }
      )
    }

    if (isBillingTierStripeIdentifierError(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    logger.error('Failed to create billing tier', { error })
    return NextResponse.json({ error: 'Failed to create billing tier' }, { status: 500 })
  }
}
