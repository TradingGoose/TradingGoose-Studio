import { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { BILLING_DISABLED_ERROR, getBillingGateState } from '@/lib/billing/settings'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ensureStripeUserCustomer } from '@/lib/billing/stripe-customers'
import { createBillingManagementPortalSession } from '@/lib/billing/stripe-portal'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('BillingPortal')
const BILLING_PORTAL_CUSTOMER_LOCK_NAMESPACE = 4_126_092

export async function POST() {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { billingEnabled } = await getBillingGateState()

    if (!billingEnabled) {
      return NextResponse.json({ error: BILLING_DISABLED_ERROR }, { status: 409 })
    }

    const stripe = requireStripeClient()

    const personalStripeCustomer = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${BILLING_PORTAL_CUSTOMER_LOCK_NAMESPACE}, hashtext(${session.user.id}))`
      )

      return ensureStripeUserCustomer(stripe, {
        dbClient: tx,
        logger,
        userId: session.user.id,
      })
    })

    if (!personalStripeCustomer) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const portal = await createBillingManagementPortalSession(stripe, {
      customer: personalStripeCustomer.id,
      return_url: `${getBaseUrl()}/workspace?billing=updated`,
    })

    return NextResponse.json({ url: portal.url })
  } catch (error) {
    logger.error('Failed to create billing portal session', { error })
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 })
  }
}
