import { db } from '@tradinggoose/db'
import {
  member,
  organization,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  subscription,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getEmailSubject, renderPaymentFailedEmail } from '@/components/emails/render-email'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import {
  getSubscriptionByStripeSubscriptionId,
  getSubscriptionRowByStripeId,
} from '@/lib/billing/core/subscription'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import {
  type BillingReference,
  type BillingTierRecord,
  hydrateSubscriptionsWithTiers,
  isOrganizationSubscription,
  type SubscriptionWithTier,
  usesIndividualBillingLedger,
} from '@/lib/billing/tiers'
import { resolveEmailLocale } from '@/lib/email/locale'
import { sendEmail } from '@/lib/email/mailer'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type BillingMetadata,
  hasClosedLedger,
  settleUsageInvoice,
  type UsageInvoice,
} from './overage'

const logger = createLogger('StripeInvoiceWebhooks')

const OVERAGE_INVOICE_TYPES = new Set<string>([
  'overage_billing',
  'overage_threshold_billing',
  'overage_threshold_billing_org',
  'final_overage_billing',
])

type SubscriptionUsageScope = {
  referenceId: string
  tier?: BillingTierRecord | null
}

/**
 * Get payment method details from Stripe invoice
 */
async function getPaymentMethodDetails(
  invoice: Stripe.Invoice
): Promise<{ lastFourDigits?: string; failureReason?: string }> {
  let lastFourDigits: string | undefined
  let failureReason: string | undefined

  // Try to get last 4 digits from payment method
  try {
    const stripe = requireStripeClient()

    // Try to get from default payment method
    if (invoice.default_payment_method && typeof invoice.default_payment_method === 'string') {
      const paymentMethod = await stripe.paymentMethods.retrieve(invoice.default_payment_method)
      if (paymentMethod.card?.last4) {
        lastFourDigits = paymentMethod.card.last4
      }
    }

    // If no default payment method, try getting from customer's default
    if (!lastFourDigits && invoice.customer && typeof invoice.customer === 'string') {
      const customer = await stripe.customers.retrieve(invoice.customer)
      if (customer && !('deleted' in customer)) {
        const defaultPm = customer.invoice_settings?.default_payment_method
        if (defaultPm && typeof defaultPm === 'string') {
          const paymentMethod = await stripe.paymentMethods.retrieve(defaultPm)
          if (paymentMethod.card?.last4) {
            lastFourDigits = paymentMethod.card.last4
          }
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to retrieve payment method details', { error, invoiceId: invoice.id })
  }

  // Get failure message - check multiple sources
  if (invoice.last_finalization_error?.message) {
    failureReason = invoice.last_finalization_error.message
  }

  // If not found, check the payments array (requires expand: ['payments'])
  if (!failureReason && invoice.payments?.data) {
    const defaultPayment = invoice.payments.data.find((p) => p.is_default)
    const payment = defaultPayment || invoice.payments.data[0]

    if (payment?.payment) {
      try {
        const stripe = requireStripeClient()

        if (payment.payment.type === 'payment_intent' && payment.payment.payment_intent) {
          const piId =
            typeof payment.payment.payment_intent === 'string'
              ? payment.payment.payment_intent
              : payment.payment.payment_intent.id

          const paymentIntent = await stripe.paymentIntents.retrieve(piId)
          if (paymentIntent.last_payment_error?.message) {
            failureReason = paymentIntent.last_payment_error.message
          }
        } else if (payment.payment.type === 'charge' && payment.payment.charge) {
          const chargeId =
            typeof payment.payment.charge === 'string'
              ? payment.payment.charge
              : payment.payment.charge.id

          const charge = await stripe.charges.retrieve(chargeId)
          if (charge.failure_message) {
            failureReason = charge.failure_message
          }
        }
      } catch (error) {
        logger.warn('Failed to retrieve payment details for failure reason', {
          error,
          invoiceId: invoice.id,
        })
      }
    }
  }

  return { lastFourDigits, failureReason }
}

/**
 * Send payment failure notification emails to affected users
 */
async function sendPaymentFailureEmails(
  sub: BillingReference,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const paymentUrl = invoice.hosted_invoice_url
    if (!paymentUrl) {
      logger.warn('Failed invoice has no hosted payment URL', { invoiceId: invoice.id })
      return
    }
    const amountDue = invoice.amount_due / 100 // Convert cents to dollars
    const { lastFourDigits, failureReason } = await getPaymentMethodDetails(invoice)

    const fields = { id: user.id, email: user.email, name: user.name }
    const recipients =
      sub.referenceType === 'organization'
        ? await db
            .select(fields)
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .where(and(eq(member.organizationId, sub.referenceId), eq(member.role, 'owner')))
        : await db.select(fields).from(user).where(eq(user.id, sub.referenceId)).limit(1)

    for (const userToNotify of recipients) {
      if (!quickValidateEmail(userToNotify.email).isValid) continue
      try {
        const locale = await resolveEmailLocale({
          userId: userToNotify.id,
          email: userToNotify.email,
        })
        const emailHtml = await renderPaymentFailedEmail({
          userName: userToNotify.name || undefined,
          amountDue,
          lastFourDigits,
          paymentUrl,
          failureReason,
          locale,
        })

        const mail = {
          to: userToNotify.email,
          userId: userToNotify.id,
          subject: getEmailSubject('payment-failed', locale),
          html: emailHtml,
          emailType: 'transactional' as const,
        }
        let result = await sendEmail(mail)
        if (
          !result.success &&
          result.currentEmail &&
          (await authorizeSubscriptionReference(userToNotify.id, sub))
        ) {
          result = await sendEmail({ ...mail, to: result.currentEmail })
        }

        if (!result.success) throw new Error(result.message)
      } catch (emailError) {
        logger.error('Failed to send payment failure email', {
          error: emailError,
          email: userToNotify.email,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to send payment failure emails', { error })
  }
}

// Usage accrual locks the organization ledger before individual member ledgers.
export async function lockBilledOverage(
  sub: SubscriptionUsageScope,
  tx: Pick<typeof db, 'select'>
) {
  const isOrganization = isOrganizationSubscription(sub)
  const table = isOrganization ? organizationBillingLedger : userStats
  const ownerId = isOrganization ? organizationBillingLedger.organizationId : userStats.userId
  const [ledger] = await tx
    .select({ billedOverage: table.billedOverageThisPeriod })
    .from(table)
    .where(eq(ownerId, sub.referenceId))
    .for('update')
  if (!ledger) return
  if (isOrganization && sub.tier && usesIndividualBillingLedger(sub.tier)) {
    await tx
      .select({ id: organizationMemberBillingLedger.userId })
      .from(organizationMemberBillingLedger)
      .where(eq(organizationMemberBillingLedger.organizationId, sub.referenceId))
      .orderBy(organizationMemberBillingLedger.userId)
      .for('update')
  }
  return Number(ledger.billedOverage)
}

export async function resetUsageForSubscription(
  sub: SubscriptionUsageScope,
  dbClient: Pick<typeof db, 'select' | 'update'> = db
) {
  if (isOrganizationSubscription(sub)) {
    const ledgerRows = await dbClient
      .select({ organizationId: organizationBillingLedger.organizationId })
      .from(organizationBillingLedger)
      .where(eq(organizationBillingLedger.organizationId, sub.referenceId))
      .limit(1)
    if (ledgerRows.length === 0) {
      return
    }

    await dbClient
      .update(organizationBillingLedger)
      .set({
        lastPeriodCost: sql`${organizationBillingLedger.currentPeriodCost}`,
        lastPeriodCopilotCost: sql`${organizationBillingLedger.currentPeriodCopilotCost}`,
        currentPeriodCost: '0',
        currentPeriodCopilotCost: '0',
        billedOverageThisPeriod: '0',
        updatedAt: new Date(),
      })
      .where(eq(organizationBillingLedger.organizationId, sub.referenceId))

    if (sub.tier && usesIndividualBillingLedger(sub.tier)) {
      await dbClient
        .update(organizationMemberBillingLedger)
        .set({
          lastPeriodCost: sql`${organizationMemberBillingLedger.currentPeriodCost}`,
          lastPeriodCopilotCost: sql`${organizationMemberBillingLedger.currentPeriodCopilotCost}`,
          currentPeriodCost: '0',
          currentPeriodCopilotCost: '0',
          updatedAt: new Date(),
        })
        .where(eq(organizationMemberBillingLedger.organizationId, sub.referenceId))
    }
  } else {
    const currentStats = await dbClient
      .select({
        current: userStats.currentPeriodCost,
        currentCopilot: userStats.currentPeriodCopilotCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)
    if (currentStats.length > 0) {
      const current = Number.parseFloat(currentStats[0].current?.toString() || '0')
      const currentCopilot = currentStats[0].currentCopilot || '0'

      await dbClient
        .update(userStats)
        .set({
          lastPeriodCost: current.toString(),
          lastPeriodCopilotCost: currentCopilot,
          currentPeriodCost: '0',
          currentPeriodCopilotCost: '0',
          billedOverageThisPeriod: '0', // Clear threshold billing tracker at period end
        })
        .where(eq(userStats.userId, sub.referenceId))
    }
  }
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  if (OVERAGE_INVOICE_TYPES.has(invoice.metadata?.type ?? ''))
    return invoice.metadata?.subscriptionId
  const parent = invoice.parent?.subscription_details?.subscription
  return typeof parent === 'string' ? parent : parent?.id
}

// The flag belongs to the billing reference; each failed invoice belongs to its subscription.
async function updatePaymentBlock(sub: SubscriptionWithTier, invoiceId: string, failed: boolean) {
  return db.transaction(async (tx) => {
    const owner = sub.referenceType === 'organization' ? organization : user
    await tx.select({ id: owner.id }).from(owner).where(eq(owner.id, sub.referenceId)).for('update')
    const rows = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, sub.referenceType),
          eq(subscription.referenceId, sub.referenceId)
        )
      )
      .orderBy(subscription.id)
      .for('update')
    const row = rows.find((record) => record.id === sub.id)
    if (!row) return
    const closed = hasClosedLedger(row)
    const metadata = row.metadata as BillingMetadata | null
    const debts = new Set(metadata?.blockedInvoices)
    if (!failed && !debts.has(invoiceId)) return

    // Stripe can deliver a stale failure after an invoice was paid or voided.
    const invoice = await requireStripeClient().invoices.retrieve(invoiceId)
    const resolved = invoice.status === 'paid' || invoice.status === 'void'
    if (resolved) {
      if (!debts.delete(invoiceId)) return
    } else {
      if (!failed) return
      if (closed || debts.has(invoiceId)) return closed
      debts.add(invoiceId)
    }
    await tx
      .update(subscription)
      .set({ metadata: { ...metadata, blockedInvoices: [...debts] } })
      .where(eq(subscription.id, row.id))
    const blocked =
      debts.size > 0 ||
      rows.some(
        (record) =>
          record.id !== row.id &&
          !!(record.metadata as BillingMetadata | null)?.blockedInvoices?.length
      )
    if (sub.referenceType === 'organization') {
      await tx
        .update(organizationBillingLedger)
        .set({ billingBlocked: blocked, updatedAt: new Date() })
        .where(eq(organizationBillingLedger.organizationId, sub.referenceId))
    } else {
      await tx
        .update(userStats)
        .set({ billingBlocked: blocked })
        .where(eq(userStats.userId, sub.referenceId))
    }
    if (!resolved) return closed
  })
}

export async function handleInvoiceResolved(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice
  const id = getInvoiceSubscriptionId(invoice)
  if (!id) return
  const sub = await getSubscriptionByStripeSubscriptionId(id)
  if (sub) await updatePaymentBlock(sub, invoice.id, false)
}

/**
 * Handle invoice payment failed webhook
 * This is triggered when a user's payment fails for any invoice (subscription or overage)
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    const invoiceType = invoice.metadata?.type
    const isOverageInvoice = !!(invoiceType && OVERAGE_INVOICE_TYPES.has(invoiceType))
    const stripeSubscriptionId = getInvoiceSubscriptionId(invoice)

    if (!stripeSubscriptionId) {
      logger.info('No subscription found on invoice; skipping payment failed handler', {
        invoiceId: invoice.id,
        isOverageInvoice,
      })
      return
    }

    // Extract and validate customer ID
    const customerId = invoice.customer
    if (!customerId || typeof customerId !== 'string') {
      logger.error('Invalid customer ID on invoice', {
        invoiceId: invoice.id,
        customer: invoice.customer,
      })
      return
    }

    const failedAmount = invoice.amount_due / 100 // Convert from cents to dollars
    const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'
    const attemptCount = invoice.attempt_count ?? 1

    logger.warn('Invoice payment failed', {
      invoiceId: invoice.id,
      customerId,
      failedAmount,
      billingPeriod,
      attemptCount,
      customerEmail: invoice.customer_email,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      isOverageInvoice,
      invoiceType: isOverageInvoice ? 'overage' : 'subscription',
    })

    if (attemptCount < 1) return
    const sub = await getSubscriptionByStripeSubscriptionId(stripeSubscriptionId)
    if (!sub) return
    const closed = await updatePaymentBlock(sub, invoice.id, true)
    if (
      attemptCount === 1 &&
      (closed === false || (closed && invoiceType === 'final_overage_billing'))
    ) {
      await sendPaymentFailureEmails(sub, invoice)
    }
  } catch (error) {
    logger.error('Failed to handle invoice payment failed', {
      eventId: event.id,
      error,
    })
    throw error // Re-throw to signal webhook failure
  }
}

/**
 * Handle base invoice finalized → create a separate overage-only invoice
 */
export async function handleInvoiceFinalized(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice
  if (invoice.billing_reason !== 'subscription_cycle') return
  const parent = invoice.parent?.subscription_details?.subscription
  const stripeSubscriptionId = typeof parent === 'string' ? parent : parent?.id
  if (!stripeSubscriptionId) return

  const canClaim = (row: { status: string | null; metadata: unknown }) =>
    !hasClosedLedger(row) &&
    ((row.metadata as BillingMetadata | null)?.renewedThrough ?? 0) < invoice.period_end
  const manual = invoice.collection_method === 'send_invoice'
  let defaults: Stripe.Subscription | undefined
  if (!invoice.default_payment_method || (manual && !invoice.due_date)) {
    const row = await getSubscriptionRowByStripeId(stripeSubscriptionId)
    if (row && canClaim(row))
      defaults = await requireStripeClient().subscriptions.retrieve(stripeSubscriptionId)
  }
  const quote = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
      .for('update')
    if (!row) return
    const metadata = row.metadata as BillingMetadata | null
    const pending = metadata?.pendingRenewals?.[invoice.id]
    if (pending) return { id: row.id, pending }
    if (!canClaim(row)) return
    const [sub] = await hydrateSubscriptionsWithTiers([row], tx)
    if (!sub) throw new Error(`Missing billing tier for renewing subscription ${row.id}`)
    const billedOverage = await lockBilledOverage(sub, tx)
    const totalOverage =
      billedOverage === undefined ? 0 : await calculateSubscriptionOverage(sub, tx)
    const pendingInvoice: UsageInvoice = {
      totalOverage,
      billedOverage: billedOverage ?? 0,
      billingPeriod: new Date(invoice.period_end * 1000).toISOString().slice(0, 7),
      tierName: sub.tier.displayName,
      ledgerStart: metadata?.renewedThrough ?? 'initial',
      collectionMethod: invoice.collection_method,
    }
    if (totalOverage > pendingInvoice.billedOverage) {
      const pm = invoice.default_payment_method ?? defaults?.default_payment_method
      if (pm) pendingInvoice.paymentMethod = typeof pm === 'string' ? pm : pm.id
      if (manual) {
        const days = invoice.due_date
          ? Math.max(0, Math.ceil((invoice.due_date - invoice.created) / 86400))
          : defaults?.days_until_due
        if (days == null) throw new Error(`Missing payment terms on renewal invoice ${invoice.id}`)
        pendingInvoice.daysUntilDue = days
      }
    }
    await tx
      .update(subscription)
      .set({
        metadata: {
          ...metadata,
          renewedThrough: invoice.period_end,
          pendingRenewals: { ...metadata?.pendingRenewals, [invoice.id]: pendingInvoice },
        },
      })
      .where(eq(subscription.id, sub.id))
    if (billedOverage !== undefined) await resetUsageForSubscription(sub, tx)
    return { id: sub.id, pending: pendingInvoice }
  })
  if (quote) {
    const customer = invoice.customer
    if (!customer) throw new Error(`Missing customer on renewal invoice ${invoice.id}`)
    await settleUsageInvoice(
      quote.id,
      stripeSubscriptionId,
      typeof customer === 'string' ? customer : customer.id,
      quote.pending,
      invoice.id
    )
  }
}
