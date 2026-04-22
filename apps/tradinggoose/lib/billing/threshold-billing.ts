import { db } from '@tradinggoose/db'
import { organizationBillingLedger, organizationMemberBillingLedger, userStats } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import {
  getSubscriptionUsageAllowanceUsd,
  getTierUsageAllowanceUsd,
  usesIndividualBillingLedger,
} from '@/lib/billing/tiers'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ThresholdBilling')

function parseDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return Number.parseFloat(value.toString())
}

async function createAndFinalizeOverageInvoice(
  stripe: ReturnType<typeof requireStripeClient>,
  params: {
    customerId: string
    stripeSubscriptionId: string
    amountCents: number
    description: string
    itemDescription: string
    metadata: Record<string, string>
    idempotencyKey: string
  }
): Promise<string> {
  const getPaymentMethodId = (
    pm: string | Stripe.PaymentMethod | null | undefined
  ): string | undefined => (typeof pm === 'string' ? pm : pm?.id)

  let defaultPaymentMethod: string | undefined
  try {
    const stripeSub = await stripe.subscriptions.retrieve(params.stripeSubscriptionId)
    const subDpm = getPaymentMethodId(stripeSub.default_payment_method)
    if (subDpm) {
      defaultPaymentMethod = subDpm
    } else {
      const custObj = await stripe.customers.retrieve(params.customerId)
      if (custObj && !('deleted' in custObj)) {
        const cust = custObj as Stripe.Customer
        const custDpm = getPaymentMethodId(cust.invoice_settings?.default_payment_method)
        if (custDpm) defaultPaymentMethod = custDpm
      }
    }
  } catch (error) {
    logger.error('Failed to retrieve subscription or customer', { error })
  }

  const invoice = await stripe.invoices.create(
    {
      customer: params.customerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      description: params.description,
      metadata: params.metadata,
      ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
    },
    { idempotencyKey: `${params.idempotencyKey}-invoice` }
  )

  await stripe.invoiceItems.create(
    {
      customer: params.customerId,
      invoice: invoice.id,
      amount: params.amountCents,
      currency: 'usd',
      description: params.itemDescription,
      metadata: params.metadata,
    },
    { idempotencyKey: params.idempotencyKey }
  )

  if (invoice.id) {
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id)

    if (finalized.status === 'open' && finalized.id) {
      try {
        await stripe.invoices.pay(finalized.id, {
          payment_method: defaultPaymentMethod,
        })
      } catch (payError) {
        logger.error('Failed to auto-pay threshold overage invoice', {
          error: payError,
          invoiceId: finalized.id,
        })
      }
    }
  }

  return invoice.id || ''
}

async function resolveThresholdBillingContext(params: {
  userId: string
  workspaceId?: string | null
  workflowId?: string | null
}) {
  if (params.workflowId) {
    return resolveWorkflowBillingContext({
      workflowId: params.workflowId,
      actorUserId: params.userId,
    })
  }

  return resolveWorkspaceBillingContext({
    workspaceId: params.workspaceId,
    actorUserId: params.userId,
  })
}

export async function checkAndBillOverageThreshold(params: {
  userId: string
  workspaceId?: string | null
  workflowId?: string | null
}): Promise<void> {
  try {
    const { overageThresholdDollars: threshold } = await getResolvedBillingSettings()
    const billingContext = await resolveThresholdBillingContext(params)
    const subscription = billingContext.subscription

    if (!subscription || subscription.status !== 'active') {
      logger.debug('No active subscription for threshold billing', {
        userId: params.userId,
        workspaceId: params.workspaceId,
        workflowId: params.workflowId,
      })
      return
    }

    if (!subscription.stripeSubscriptionId) {
      return
    }
    const stripeSubscriptionId = subscription.stripeSubscriptionId

    await db.transaction(async (tx) => {
      const isOrganizationScope =
        billingContext.scopeType === 'organization' ||
        billingContext.scopeType === 'organization_member'
      const organizationId =
        billingContext.billingOwner.type === 'organization'
          ? billingContext.billingOwner.organizationId
          : null
      let statsRecord:
        | typeof organizationBillingLedger.$inferSelect
        | typeof userStats.$inferSelect
        | null = null

      if (isOrganizationScope) {
        const records = await tx
          .select()
          .from(organizationBillingLedger)
          .where(eq(organizationBillingLedger.organizationId, organizationId ?? billingContext.scopeId))
          .for('update')
          .limit(1)

        statsRecord = records[0] ?? null

        if (!statsRecord) {
          await tx
            .insert(organizationBillingLedger)
            .values({
              organizationId: organizationId ?? billingContext.scopeId,
            })
            .onConflictDoNothing({
              target: [organizationBillingLedger.organizationId],
            })

          const seededRecords = await tx
            .select()
            .from(organizationBillingLedger)
            .where(eq(organizationBillingLedger.organizationId, organizationId ?? billingContext.scopeId))
            .for('update')
            .limit(1)

          statsRecord = seededRecords[0] ?? null
        }
      } else {
        const records = await tx
          .select()
          .from(userStats)
          .where(eq(userStats.userId, billingContext.billingUserId))
          .for('update')
          .limit(1)

        statsRecord = records[0] ?? null
      }

      if (!statsRecord) {
        logger.warn('Billing ledger not found for threshold billing', {
          actorUserId: params.userId,
          billingUserId: billingContext.billingUserId,
          billingScopeType: billingContext.scopeType,
          billingScopeId: billingContext.scopeId,
          workspaceId: params.workspaceId,
          workflowId: params.workflowId,
        })
        return
      }

      const billedOverageThisPeriod = parseDecimal(statsRecord.billedOverageThisPeriod)
      const usageAllowance =
        isOrganizationScope && subscription.tier && usesIndividualBillingLedger(subscription.tier)
          ? getTierUsageAllowanceUsd(subscription.tier)
          : getSubscriptionUsageAllowanceUsd(subscription)
      const currentPeriodCost =
        isOrganizationScope && subscription.tier && usesIndividualBillingLedger(subscription.tier)
          ? (
              await tx
                .select({ currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost })
                .from(organizationMemberBillingLedger)
                .where(eq(organizationMemberBillingLedger.organizationId, organizationId!))
            ).reduce((total, row) => total + parseDecimal(row.currentPeriodCost), 0)
          : parseDecimal(statsRecord.currentPeriodCost)
      const currentOverage =
        isOrganizationScope && subscription.tier && usesIndividualBillingLedger(subscription.tier)
          ? (
              await tx
                .select({ currentPeriodCost: organizationMemberBillingLedger.currentPeriodCost })
                .from(organizationMemberBillingLedger)
                .where(eq(organizationMemberBillingLedger.organizationId, organizationId!))
            ).reduce((total, row) => {
              const memberUsage = parseDecimal(row.currentPeriodCost)
              return total + Math.max(0, memberUsage - usageAllowance)
            }, 0)
          : Math.max(0, currentPeriodCost - usageAllowance)
      const unbilledOverage = Math.max(0, currentOverage - billedOverageThisPeriod)

      logger.debug('Threshold billing check', {
        actorUserId: params.userId,
        billingUserId: billingContext.billingUserId,
        billingScopeType: billingContext.scopeType,
        billingScopeId: billingContext.scopeId,
        billingTier: billingContext.tier.displayName,
        currentPeriodCost,
        usageAllowance,
        currentOverage,
        billedOverageThisPeriod,
        unbilledOverage,
        threshold,
      })

      if (unbilledOverage < threshold) {
        return
      }

      const amountToBill = unbilledOverage

      const stripe = requireStripeClient()
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      const customerId =
        typeof stripeSubscription.customer === 'string'
          ? stripeSubscription.customer
          : stripeSubscription.customer.id

      const periodEnd = subscription.periodEnd
        ? Math.floor(subscription.periodEnd.getTime() / 1000)
        : Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)

      const amountCents = Math.round(amountToBill * 100)
      const totalOverageCents = Math.round(currentOverage * 100)
      const idempotencyKey = `threshold-overage:${billingContext.scopeType}:${billingContext.scopeId}:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${totalOverageCents}:${amountCents}`

      logger.info('Creating threshold overage invoice', {
        actorUserId: params.userId,
        billingUserId: billingContext.billingUserId,
        billingScopeType: billingContext.scopeType,
        billingScopeId: billingContext.scopeId,
        amountToBill,
        billingPeriod,
        idempotencyKey,
      })

      const invoiceId = await createAndFinalizeOverageInvoice(stripe, {
        customerId,
        stripeSubscriptionId,
        amountCents,
        description: `Threshold overage billing – ${billingPeriod}`,
        itemDescription: `Usage overage ($${amountToBill.toFixed(2)})`,
        metadata: {
          type: 'overage_threshold_billing',
          actorUserId: params.userId,
          billingUserId: billingContext.billingUserId,
          billingScopeId: billingContext.scopeId,
          billingScopeType: billingContext.scopeType,
          workspaceId: params.workspaceId ?? '',
          workflowId: params.workflowId ?? '',
          subscriptionId: stripeSubscriptionId,
          billingPeriod,
          currentPeriodCost: currentPeriodCost.toFixed(2),
          usageAllowance: usageAllowance.toFixed(2),
          currentOverage: currentOverage.toFixed(2),
        },
        idempotencyKey,
      })

      if (isOrganizationScope) {
        await tx
          .update(organizationBillingLedger)
          .set({
            billedOverageThisPeriod: sql`${organizationBillingLedger.billedOverageThisPeriod} + ${amountToBill}`,
            updatedAt: new Date(),
          })
          .where(eq(organizationBillingLedger.organizationId, organizationId ?? billingContext.scopeId))
      } else {
        await tx
          .update(userStats)
          .set({
            billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${amountToBill}`,
          })
          .where(eq(userStats.userId, billingContext.billingUserId))
      }

      logger.info('Successfully created and finalized threshold overage invoice', {
        actorUserId: params.userId,
        billingUserId: billingContext.billingUserId,
        billingScopeType: billingContext.scopeType,
        billingScopeId: billingContext.scopeId,
        amountBilled: amountToBill,
        invoiceId,
        newBilledTotal: billedOverageThisPeriod + amountToBill,
      })
    })
  } catch (error) {
    logger.error('Error in threshold billing check', {
      userId: params.userId,
      workspaceId: params.workspaceId,
      workflowId: params.workflowId,
      error,
    })
  }
}
