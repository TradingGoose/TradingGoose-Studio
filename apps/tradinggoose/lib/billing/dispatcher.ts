import {
  acceptInvoicePayment,
  acknowledgeInvoiceIssued,
  advanceFinancialDispatch,
  type DispatchClaim,
  drainFinancialDispatch,
  evaluateFinancialPeriod,
  type FinancialDispatchDrainOptions,
  financialFingerprint,
  type InvoiceReceipt,
  prepareFinancialContact,
} from '@tradinggoose/billing'
import { centsToProviderNumber, decimalFromSafeInteger } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import Stripe from 'stripe'
import { executeFinancialNotification } from '@/lib/billing/financial-notifications'
import { getStripeServiceConfig } from '@/lib/system-services/stripe-runtime'

/** One invocation visits each owning receipt once; all provider work shares one 20s quantum. */
export async function dispatchFinancialMarkers(
  options: { now?: () => number; execute?: FinancialDispatchDrainOptions['execute'] } = {}
) {
  return drainFinancialDispatch(db, {
    now: options.now,
    execute: options.execute ?? executeFinancialHead,
  })
}

type OriginalPaymentMethod = { id: string; source: 'subscription' | 'customer' }
type InvoiceRequest =
  | { operation: 'create'; params: Stripe.InvoiceCreateParams }
  | { operation: 'item'; params: Stripe.InvoiceItemCreateParams }
  | { operation: 'finalize'; params: Stripe.InvoiceFinalizeInvoiceParams }
  | { operation: 'pay'; params: Stripe.InvoicePayParams }
const referenceId = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id
const customerId = (invoice: Stripe.Invoice) => referenceId(invoice.customer)
function invoicePaymentMethod(invoice: Stripe.Invoice): OriginalPaymentMethod {
  const id = referenceId(invoice.default_payment_method)
  const source = invoice.metadata?.financialPaymentMethodSource
  if (
    !id ||
    invoice.metadata?.financialPaymentMethod !== id ||
    (source !== 'subscription' && source !== 'customer')
  )
    throw new Error('Original invoice payment method binding is missing or changed')
  return { id, source }
}
function assertInvoice(
  invoice: Stripe.Invoice,
  intent: InvoiceReceipt,
  expectedMethod?: OriginalPaymentMethod
) {
  if (
    (intent.invoiceId !== undefined && invoice.id !== intent.invoiceId) ||
    customerId(invoice) !== intent.period.customerId ||
    invoice.currency !== 'usd' ||
    invoice.metadata?.financialFingerprint !== intent.fingerprint ||
    invoice.metadata?.subscriptionId !== intent.period.stripeSubscriptionId ||
    invoice.metadata?.periodStart !== intent.period.start ||
    invoice.metadata?.periodEnd !== intent.period.end ||
    (invoice.status !== 'draft' && decimalFromSafeInteger(invoice.total) !== intent.amountCents)
  )
    throw new Error('Provider invoice does not match original accepted financial intent')
  const method = invoicePaymentMethod(invoice)
  if (expectedMethod && financialFingerprint(method) !== financialFingerprint(expectedMethod))
    throw new Error('Original invoice payment method changed')
}
async function executeFinancialHead(claim: DispatchClaim, deadlineAt: number) {
  const marker = claim.marker
  if (marker.kind === 'evaluate') {
    await db.transaction((tx) =>
      evaluateFinancialPeriod(
        tx,
        claim.candidate.namespace,
        typeof marker.payload?.periodKey === 'string'
          ? marker.payload.periodKey
          : claim.candidate.key,
        marker.phase
      )
    )
    await db.transaction((tx) =>
      advanceFinancialDispatch(
        tx,
        claim,
        (_receipt, head) => {
          head.state = 'complete'
        },
        Date.now()
      )
    )
    return
  }
  if (marker.kind === 'notification') return executeFinancialNotification(claim, deadlineAt)
  if (claim.receipt.recordType !== 'invoice')
    throw new Error('Invoice marker has no accepted financial intent')
  const intent = claim.receipt
  const secretKey = getStripeServiceConfig().secretKey
  if (!secretKey) throw new Error('Financial Stripe provider is not configured')
  const signal = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()))
  const contactedRequests = new Set<string>()
  const stripe = new Stripe(secretKey, {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient((url: string, init: RequestInit) => {
      const remaining = deadlineAt - Date.now()
      if (remaining <= 0) throw new Error('Financial provider quantum expired before contact')
      const request = `${(init.method ?? 'GET').toUpperCase()}:${url}`
      if (contactedRequests.has(request))
        throw new Error('Repeated Stripe transport requires financial reconciliation')
      contactedRequests.add(request)
      return fetch(url, { ...init, signal })
    }),
  })
  const requestKey = `${intent.requestKey}:${marker.phase}`
  const fingerprint = financialFingerprint({ intent: intent.fingerprint, phase: marker.phase })
  const original = {
    namespace: claim.candidate.namespace,
    key: claim.candidate.key,
    intentFingerprint: intent.fingerprint,
    customerId: intent.period.customerId,
    subscriptionId: intent.period.stripeSubscriptionId,
    period: structuredClone(intent.period),
    amountCents: intent.amountCents,
    invoiceId: intent.invoiceId ?? null,
    phase: marker.phase,
  }
  const metadata = (method: OriginalPaymentMethod) => ({
    type: 'overage_billing',
    subtype: intent.subtype,
    financialNamespace: claim.candidate.namespace,
    financialKey: claim.candidate.key,
    financialFingerprint: intent.fingerprint,
    subscriptionId: intent.period.stripeSubscriptionId!,
    periodStart: intent.period.start!,
    periodEnd: intent.period.end!,
    financialPaymentMethod: method.id,
    financialPaymentMethodSource: method.source,
  })
  const requestFor = (method: OriginalPaymentMethod): InvoiceRequest => {
    switch (marker.phase) {
      case 'create':
        return {
          operation: 'create',
          params: {
            customer: intent.period.customerId!,
            currency: 'usd',
            collection_method: 'charge_automatically',
            auto_advance: false,
            default_payment_method: method.id,
            metadata: metadata(method),
          },
        }
      case 'item':
        if (!intent.invoiceId) throw new Error('Invoice create acknowledgement missing')
        return {
          operation: 'item',
          params: {
            customer: intent.period.customerId!,
            invoice: intent.invoiceId,
            amount: centsToProviderNumber(intent.amountCents),
            currency: 'usd',
            ...(intent.period.start && intent.period.end
              ? {
                  period: {
                    start: Math.floor(Date.parse(intent.period.start) / 1000),
                    end: Math.floor(Date.parse(intent.period.end) / 1000),
                  },
                }
              : {}),
            metadata: metadata(method),
          },
        }
      case 'finalize':
        return { operation: 'finalize', params: { auto_advance: false } }
      case 'pay':
        return { operation: 'pay', params: { payment_method: method.id } }
      default:
        throw new Error('Unknown financial invoice phase')
    }
  }
  const envelopeFor = (method: OriginalPaymentMethod) => {
    const request = requestFor(method)
    return {
      version: 1,
      stage: 'request',
      original,
      paymentMethod: method,
      request,
      requestFingerprint: financialFingerprint(request),
    }
  }
  const prepared =
    claim.reconcile ||
    ['payload', 'requestKey', 'requestFingerprint', 'provider', 'firstContactAtMs'].some((field) =>
      Object.hasOwn(marker, field)
    )
  let frozenMethod: OriginalPaymentMethod | undefined
  if (prepared) {
    const raw = marker.payload
    const method = raw?.paymentMethod
    if (
      !method ||
      typeof method !== 'object' ||
      !('id' in method) ||
      typeof method.id !== 'string' ||
      !method.id.trim() ||
      !('source' in method) ||
      (method.source !== 'subscription' && method.source !== 'customer')
    )
      throw new Error('Original financial request envelope is missing; reconciliation required')
    frozenMethod = { id: method.id, source: method.source }
    if (financialFingerprint(raw) !== financialFingerprint(envelopeFor(frozenMethod)))
      throw new Error('Original financial request envelope changed; reconciliation required')
  }
  await db.transaction((tx) =>
    prepareFinancialContact(tx, claim, {
      provider: 'stripe',
      requestKey,
      fingerprint,
      now: Date.now(),
    })
  )
  const requestOptions = () => {
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) throw new Error('Financial provider quantum deadline expired')
    return { idempotencyKey: requestKey, maxNetworkRetries: 0, timeout: remaining }
  }
  const freezeRequest = async (method: OriginalPaymentMethod) => {
    const envelope = envelopeFor(method)
    if (prepared && financialFingerprint(marker.payload) !== financialFingerprint(envelope))
      throw new Error('Original financial request envelope changed; reconciliation required')
    await db.transaction((tx) =>
      prepareFinancialContact(tx, claim, {
        provider: 'stripe',
        requestKey,
        fingerprint,
        now: Date.now(),
        payload: envelope,
      })
    )
    return envelope.request
  }
  let invoice: Stripe.Invoice | undefined
  if (intent.invoiceId) {
    invoice = await stripe.invoices.retrieve(intent.invoiceId, {}, requestOptions())
    assertInvoice(invoice, intent, frozenMethod)
  } else if (claim.reconcile) {
    const page = await stripe.invoices.list(
      { customer: intent.period.customerId!, limit: 100 },
      requestOptions()
    )
    const matches = page.data.filter(
      (candidate) => candidate.metadata?.financialFingerprint === intent.fingerprint
    )
    if (matches.length !== 1 || page.has_more)
      throw new Error('Unknown invoice creation requires original-customer reconciliation')
    invoice = matches[0]
    assertInvoice(invoice, intent, frozenMethod)
  }
  // A retry never renews the first-contact retention window or changes provider identity.
  const safeReplay = Date.now() - (claim.marker.firstContactAtMs ?? 0) < 23 * 60 * 60 * 1000
  if (claim.reconcile && !invoice && !safeReplay)
    throw new Error('Provider idempotency retention expired; invoice remains classified')
  let next = marker.phase
  let invoiceId = invoice?.id
  let itemId = intent.itemId
  if (marker.phase === 'create') {
    if (!invoice) {
      if (!frozenMethod) {
        const subscription = await stripe.subscriptions.retrieve(
          intent.period.stripeSubscriptionId!,
          {},
          requestOptions()
        )
        const customer = await stripe.customers.retrieve(
          intent.period.customerId!,
          {},
          requestOptions()
        )
        if (
          subscription.id !== intent.period.stripeSubscriptionId ||
          referenceId(subscription.customer) !== intent.period.customerId ||
          customer.id !== intent.period.customerId ||
          customer.deleted
        )
          throw new Error('Original subscription/customer payment authority does not match')
        let id: string | undefined
        let source: OriginalPaymentMethod['source']
        if (subscription.default_payment_method === null) {
          id = referenceId(customer.invoice_settings.default_payment_method)
          source = 'customer'
        } else {
          id = referenceId(subscription.default_payment_method)
          source = 'subscription'
        }
        if (!id) throw new Error('Original subscription/customer payment method is unavailable')
        const method = await stripe.customers.retrievePaymentMethod(
          customer.id,
          id,
          {},
          requestOptions()
        )
        if (method.id !== id || referenceId(method.customer) !== customer.id)
          throw new Error('Original payment method ownership does not match')
        frozenMethod = { id, source }
      }
      const request = await freezeRequest(frozenMethod)
      if (request.operation !== 'create') throw new Error('Original invoice phase changed')
      invoice = await stripe.invoices.create(request.params, requestOptions())
    }
    assertInvoice(invoice, intent, frozenMethod)
    invoiceId = invoice.id
    next = 'item'
  } else if (marker.phase === 'item') {
    if (!invoiceId) throw new Error('Invoice create acknowledgement missing')
    if (claim.reconcile) {
      const lines = await stripe.invoiceItems.list(
        { customer: intent.period.customerId!, invoice: invoiceId, limit: 100 },
        requestOptions()
      )
      const matches = lines.data.filter(
        (item) => item.metadata?.financialFingerprint === intent.fingerprint
      )
      if (matches.length === 1 && !lines.has_more) itemId = matches[0].id
      else if (!safeReplay || matches.length > 1 || lines.has_more)
        throw new Error('Invoice item acknowledgement requires reconciliation')
    }
    if (!itemId) {
      const request = await freezeRequest(invoicePaymentMethod(invoice!))
      if (request.operation !== 'item') throw new Error('Original invoice phase changed')
      const item = await stripe.invoiceItems.create(request.params, requestOptions())
      itemId = item.id
    }
    next = 'finalize'
  } else if (marker.phase === 'finalize') {
    if (!invoiceId || !invoice) throw new Error('Invoice binding missing')
    if (invoice.status === 'draft') {
      const method = invoicePaymentMethod(invoice)
      const request = await freezeRequest(method)
      if (request.operation !== 'finalize') throw new Error('Original invoice phase changed')
      invoice = await stripe.invoices.finalizeInvoice(invoiceId, request.params, requestOptions())
      assertInvoice(invoice, intent, method)
    }
    if (decimalFromSafeInteger(invoice.total) !== intent.amountCents)
      throw new Error('Finalized invoice amount differs from accepted financial intent')
    await db.transaction((tx) =>
      acknowledgeInvoiceIssued(tx, claim.candidate.namespace, claim.candidate.key, invoiceId!)
    )
    next = 'pay'
  } else if (marker.phase === 'pay') {
    if (!invoiceId || !invoice) throw new Error('Invoice binding missing')
    if (invoice.status !== 'paid') {
      if (claim.reconcile && !safeReplay)
        throw new Error('Payment acknowledgement requires reconciliation after retention expiry')
      const method = invoicePaymentMethod(invoice)
      const request = await freezeRequest(method)
      if (request.operation !== 'pay') throw new Error('Original invoice phase changed')
      invoice = await stripe.invoices.pay(invoiceId, request.params, requestOptions())
      assertInvoice(invoice, intent, method)
    }
    if (
      invoice.status !== 'paid' ||
      decimalFromSafeInteger(invoice.amount_paid) !== intent.amountCents
    )
      throw new Error('Accepted invoice remains unpaid')
    await db.transaction((tx) =>
      acceptInvoicePayment(tx, {
        namespace: claim.candidate.namespace,
        key: claim.candidate.key,
        invoiceId: invoiceId!,
        customerId: intent.period.customerId!,
        amountCents: intent.amountCents,
        currency: intent.currency,
        paid: true,
        fingerprint: intent.fingerprint,
        period: intent.period,
      })
    )
    return
  } else throw new Error('Unknown financial invoice phase')
  await db.transaction((tx) =>
    advanceFinancialDispatch(
      tx,
      claim,
      (receipt, head) => {
        if (receipt.recordType !== 'invoice') throw new Error('Invoice receipt changed')
        receipt.invoiceId = invoiceId
        receipt.itemId = itemId
        head.phase = next
        head.state = 'pending'
        head.nextAtMs = Date.now()
        head.payload = undefined
        head.firstContactAtMs = undefined
        head.requestKey = undefined
        head.requestFingerprint = undefined
        head.provider = undefined
      },
      Date.now()
    )
  )
}
