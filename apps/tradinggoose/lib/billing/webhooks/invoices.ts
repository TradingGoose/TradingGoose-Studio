import {
  acceptInvoicePayment,
  acknowledgeInvoiceIssued,
  FinancialPolicyError,
  type FinancialRoot,
  type FinancialTransaction,
  financialNamespace,
  type InvoiceReceipt,
  lockFinancialRoots,
  type Period,
  periodKey,
  readFinancialReceipt,
  readSubscriptionInvoice,
  registerSubscriptionInvoice,
} from '@tradinggoose/billing'
import { decimalFromSafeInteger } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { BILLING_ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'

const subscriptionId = (invoice: Stripe.Invoice) => {
  const value = invoice.parent?.subscription_details?.subscription
  return typeof value === 'string' ? value : value?.id
}
const customerId = (invoice: Stripe.Invoice) =>
  typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id

type VerifiedProviderCredit = {
  kind: 'verified-provider-credit'
  disposition: 'no-local-debit'
  invoiceId: string
  root: FinancialRoot
  period: Period
  currency: 'usd'
  signedTotalCents: string
  creditedInvoiceIds: readonly string[]
}
type FinancialInvoice =
  | (NonNullable<Awaited<ReturnType<typeof readSubscriptionInvoice>>> & { kind: 'debt' })
  | VerifiedProviderCredit

/** Provider totals are signed safe integer cents, distinct from canonical nonnegative money. */
function signedTotalCents(total: number): string {
  if (!Number.isSafeInteger(total))
    throw new FinancialPolicyError('Signed invoice total must be a safe signed integer')
  return String(total)
}

type ServicePeriod = { start: string; end: string }
type ServiceEvidence = {
  anchor?: ServicePeriod
  adjustments: ServicePeriod[]
  creditedInvoiceIds: string[]
}
const samePeriod = (left: Period, right: Period) => periodKey(left) === periodKey(right)
function linePeriod(line: Stripe.InvoiceLineItem, recurring: boolean): ServicePeriod {
  const start = line.period?.start
  const end = line.period?.end
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    (recurring ? end <= start : end < start) ||
    !Number.isFinite(new Date(start * 1000).getTime()) ||
    !Number.isFinite(new Date(end * 1000).getTime())
  )
    throw new FinancialPolicyError('Signed invoice original service period is invalid')
  return { start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() }
}
function originalServiceEvidence(invoice: Stripe.Invoice, target: string): ServiceEvidence {
  if (invoice.lines?.has_more !== false || !Array.isArray(invoice.lines.data))
    throw new FinancialPolicyError('Complete original invoice service-period evidence is required')
  const anchors = new Map<string, ServicePeriod>()
  const adjustments: ServicePeriod[] = []
  const creditedInvoiceIds = new Set<string>()
  let unclassified = false
  for (const line of invoice.lines.data) {
    const parent = line.parent
    const details =
      parent?.type === 'subscription_item_details'
        ? parent.subscription_item_details
        : parent?.type === 'invoice_item_details'
          ? parent.invoice_item_details
          : null
    const generated = details?.subscription
    const direct = typeof line.subscription === 'string' ? line.subscription : line.subscription?.id
    if (generated !== target && direct !== target) continue
    if (
      !details ||
      typeof details.proration !== 'boolean' ||
      (generated != null && (typeof generated !== 'string' || !generated)) ||
      (generated && direct && generated !== direct)
    )
      throw new FinancialPolicyError('Signed invoice subscription line classification is invalid')
    const recurring = parent?.type === 'subscription_item_details' && !details.proration
    const period = linePeriod(line, recurring)
    if (recurring) anchors.set(JSON.stringify(period), period)
    else if (details.proration) {
      adjustments.push(period)
      const credited = details.proration_details?.credited_items
      if (credited) {
        if (typeof credited.invoice !== 'string' || !credited.invoice)
          throw new FinancialPolicyError('Signed proration original invoice reference is invalid')
        creditedInvoiceIds.add(credited.invoice)
      }
    } else unclassified = true
  }
  if (anchors.size > 1 || (!anchors.size && (!adjustments.length || unclassified)))
    throw new FinancialPolicyError('Signed invoice original service period is missing or ambiguous')
  return {
    anchor: anchors.values().next().value,
    adjustments,
    creditedInvoiceIds: [...creditedInvoiceIds],
  }
}
function containsAdjustments(period: Period, evidence: ServiceEvidence) {
  const start = Date.parse(period.start ?? '')
  const end = Date.parse(period.end ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new FinancialPolicyError('Original complete financial period is invalid')
  return evidence.adjustments.every(
    (adjustment) => Date.parse(adjustment.start) >= start && Date.parse(adjustment.end) <= end
  )
}
function assertRetainedService(
  invoice: Stripe.Invoice,
  intent: InvoiceReceipt,
  evidence: ServiceEvidence
) {
  if (
    intent.period.stripeSubscriptionId !== subscriptionId(invoice) ||
    intent.period.customerId !== customerId(invoice) ||
    intent.currency !== invoice.currency ||
    intent.amountCents !== signedTotalCents(invoice.total) ||
    (evidence.anchor
      ? intent.period.start !== evidence.anchor.start || intent.period.end !== evidence.anchor.end
      : !containsAdjustments(intent.period, evidence))
  )
    throw new FinancialPolicyError('Retained signed subscription invoice binding mismatch')
}
async function originalProrationPeriod(
  tx: FinancialTransaction,
  root: FinancialRoot,
  original: typeof subscription.$inferSelect,
  evidence: ServiceEvidence
): Promise<Period> {
  const namespace = financialNamespace(root)
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (head && (head.recordType !== 'period-head' || financialNamespace(head.root) !== namespace))
    throw new FinancialPolicyError('Original proration financial head is invalid')
  const rowPeriod: Period = {
    subscriptionId: original.id,
    stripeSubscriptionId: original.stripeSubscriptionId,
    customerId: original.stripeCustomerId,
    start: original.periodStart?.toISOString() ?? null,
    end: original.periodEnd?.toISOString() ?? null,
  }
  const candidates: Period[] = [rowPeriod]
  if (evidence.anchor) candidates.push({ ...rowPeriod, ...evidence.anchor })
  if (head?.recordType === 'period-head') {
    if (head.current) candidates.push(head.current)
    if (head.previous) candidates.push(head.previous)
  }
  for (const invoiceId of evidence.creditedInvoiceIds) {
    const credited = await readSubscriptionInvoice(tx, invoiceId)
    if (!credited) continue
    if (
      financialNamespace(credited.intent.root) !== namespace ||
      credited.intent.period.subscriptionId !== original.id ||
      credited.intent.period.stripeSubscriptionId !== original.stripeSubscriptionId ||
      credited.intent.period.customerId !== original.stripeCustomerId ||
      credited.intent.currency !== 'usd'
    )
      throw new FinancialPolicyError('Credited invoice original financial binding mismatch')
    candidates.push(credited.intent.period)
  }
  const proven = new Map<string, Period>()
  for (const period of candidates) {
    if (
      period.subscriptionId !== original.id ||
      period.stripeSubscriptionId !== original.stripeSubscriptionId ||
      period.customerId !== original.stripeCustomerId ||
      !period.start ||
      !period.end ||
      (evidence.anchor
        ? period.start !== evidence.anchor.start || period.end !== evidence.anchor.end
        : !containsAdjustments(period, evidence))
    )
      continue
    const key = periodKey(period)
    if (proven.has(key)) continue
    const basis = await readFinancialReceipt(tx, namespace, key)
    if (basis) {
      const current =
        head?.recordType === 'period-head' && head.current && samePeriod(head.current, period)
      if (
        basis.recordType !== 'period' ||
        financialNamespace(basis.root) !== namespace ||
        !samePeriod(basis.period, period) ||
        (basis.closing
          ? !Number.isFinite(Date.parse(basis.closing.frozenAt)) ||
            (root.type === 'user'
              ? basis.closing.mode !== 'user'
              : !['pooled', 'individual'].includes(basis.closing.mode))
          : !current ||
            !samePeriod(rowPeriod, period) ||
            (!basis.suspension &&
              !BILLING_ENTITLED_SUBSCRIPTION_STATUSES.some((status) => status === original.status)))
      )
        throw new FinancialPolicyError('Proration requires its verified original closing basis')
    } else if (
      head ||
      !samePeriod(rowPeriod, period) ||
      !BILLING_ENTITLED_SUBSCRIPTION_STATUSES.some((status) => status === original.status)
    )
      throw new FinancialPolicyError('Proration original financial period basis is missing')
    // A no-head exact entitled row proves only current service identity here. Credit
    // classification never initializes a basis; only canonical debit registration can do so.
    proven.set(key, period)
  }
  if (proven.size !== 1)
    throw new FinancialPolicyError(
      'Proration original complete financial period is missing or ambiguous'
    )
  return [...proven.values()][0]
}

/** Called only by the signature-verified Stripe event handler. No network work runs here. */
async function financialInvoice(invoice: Stripe.Invoice): Promise<FinancialInvoice | null> {
  const invoiceId = invoice.id
  if (!invoiceId) throw new FinancialPolicyError('Signed financial invoice ID is missing')
  const namespace = invoice.metadata?.financialNamespace
  const key = invoice.metadata?.financialKey
  const fingerprint = invoice.metadata?.financialFingerprint
  if (namespace || key || fingerprint || invoice.metadata?.type === 'overage_billing') {
    if (!namespace || !key || !fingerprint)
      throw new FinancialPolicyError(
        'Signed overage invoice has incomplete original financial references'
      )
    const intent = await readFinancialReceipt(db, namespace, key)
    if (!intent || intent.recordType !== 'invoice' || intent.subtype === 'subscription')
      throw new FinancialPolicyError('Signed overage invoice has no accepted original intent')
    assertOriginalInvoice(invoice, intent, namespace, key)
    return { kind: 'debt', namespace, key, intent }
  }
  const retained = await readSubscriptionInvoice(db, invoiceId)
  if (retained) {
    const originalStripeId = retained.intent.period.stripeSubscriptionId
    if (!originalStripeId)
      throw new FinancialPolicyError('Retained original Stripe subscription is missing')
    assertRetainedService(
      invoice,
      retained.intent,
      originalServiceEvidence(invoice, originalStripeId)
    )
    return { kind: 'debt', ...retained }
  }
  const stripeSubscriptionId = subscriptionId(invoice)
  if (!stripeSubscriptionId) {
    if (invoice.parent?.type === 'subscription_details')
      throw new FinancialPolicyError('Signed invoice original subscription is missing')
    return null
  }
  const evidence = originalServiceEvidence(invoice, stripeSubscriptionId)
  const total = invoice.total
  const signedAmount = signedTotalCents(total)
  return db.transaction(async (tx) => {
    const originals = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
      .limit(2)
    if (originals.length !== 1)
      throw new FinancialPolicyError('Signed invoice original subscription is missing or ambiguous')
    const [initial] = originals
    const root: FinancialRoot = { type: initial.referenceType, id: initial.referenceId }
    await lockFinancialRoots(tx, [root])
    const [original] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.id, initial.id),
          eq(subscription.stripeSubscriptionId, stripeSubscriptionId)
        )
      )
      .for('update')
      .limit(1)
    if (
      !original ||
      original.referenceType !== root.type ||
      original.referenceId !== root.id ||
      original.stripeCustomerId !== customerId(invoice)
    )
      throw new FinancialPolicyError(
        'Signed invoice original customer/subscription binding changed'
      )
    const raced = await readSubscriptionInvoice(tx, invoiceId)
    if (raced) {
      if (
        financialNamespace(raced.intent.root) !== financialNamespace(root) ||
        raced.intent.period.subscriptionId !== original.id
      )
        throw new FinancialPolicyError('Retained invoice original owner changed')
      assertRetainedService(invoice, raced.intent, evidence)
      return { kind: 'debt', ...raced } as const
    }
    if (total < 0) {
      if (invoice.currency !== 'usd')
        throw new FinancialPolicyError('Signed subscription invoice currency is invalid')
      const period = await originalProrationPeriod(tx, root, original, evidence)
      return {
        kind: 'verified-provider-credit',
        disposition: 'no-local-debit',
        invoiceId,
        root,
        period,
        currency: 'usd',
        signedTotalCents: signedAmount,
        creditedInvoiceIds: [...evidence.creditedInvoiceIds],
      } as const
    }
    const period: Period = evidence.anchor
      ? {
          subscriptionId: original.id,
          stripeSubscriptionId,
          customerId: original.stripeCustomerId,
          ...evidence.anchor,
        }
      : await originalProrationPeriod(tx, root, original, evidence)
    const registered = await registerSubscriptionInvoice(tx, {
      root,
      period,
      invoiceId,
      amountCents: decimalFromSafeInteger(total),
      currency: invoice.currency,
    })
    return { kind: 'debt', ...registered } as const
  })
}

function assertOriginalInvoice(
  invoice: Stripe.Invoice,
  intent: InvoiceReceipt,
  namespace: string,
  key: string
) {
  if (
    financialNamespace(intent.root) !== namespace ||
    intent.period.customerId !== customerId(invoice) ||
    intent.currency !== invoice.currency ||
    intent.amountCents !== signedTotalCents(invoice.total) ||
    (intent.invoiceId && intent.invoiceId !== invoice.id) ||
    invoice.metadata?.financialKey !== key ||
    invoice.metadata?.financialFingerprint !== intent.fingerprint ||
    invoice.metadata?.subscriptionId !== intent.period.stripeSubscriptionId ||
    invoice.metadata?.periodStart !== intent.period.start ||
    invoice.metadata?.periodEnd !== intent.period.end
  )
    throw new FinancialPolicyError('Signed invoice original financial binding mismatch')
}

async function settleSignedInvoice(event: Stripe.Event, paid: boolean) {
  const invoice = event.data.object as Stripe.Invoice
  const invoiceId = invoice.id
  if (!invoiceId) throw new FinancialPolicyError('Signed financial invoice ID is missing')
  if (paid && invoice.status !== 'paid')
    throw new FinancialPolicyError('Signed success event does not prove a paid invoice')
  const bound = await financialInvoice(invoice)
  if (!bound) return
  if (bound.kind === 'verified-provider-credit') return bound
  await db.transaction(async (tx) => {
    if (bound.intent.invoiceObligationState === 'open')
      await lockFinancialRoots(tx, [bound.intent.root])
    return acceptInvoicePayment(tx, {
      namespace: bound.namespace,
      key: bound.key,
      invoiceId,
      customerId: customerId(invoice)!,
      amountCents: decimalFromSafeInteger(invoice.total),
      currency: invoice.currency,
      fingerprint: bound.intent.fingerprint,
      period: bound.intent.period,
      paid,
      notifyFailure: (invoice.attempt_count ?? 1) === 1,
    })
  })
}

export async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  return settleSignedInvoice(event, true)
}

export async function handleInvoicePaymentFailed(event: Stripe.Event) {
  return settleSignedInvoice(event, false)
}

export async function handleInvoiceFinalized(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice
  const invoiceId = invoice.id
  if (!invoiceId) throw new FinancialPolicyError('Signed financial invoice ID is missing')
  const bound = await financialInvoice(invoice)
  if (!bound) return
  if (bound.kind === 'verified-provider-credit') return bound
  if (bound.intent.subtype === 'subscription') return
  await db.transaction((tx) => acknowledgeInvoiceIssued(tx, bound.namespace, bound.key, invoiceId))
}
