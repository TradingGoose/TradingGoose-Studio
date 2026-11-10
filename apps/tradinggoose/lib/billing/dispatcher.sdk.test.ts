/** @vitest-environment node */
import type {
  DispatchClaim,
  FinancialDispatchDrainOptions,
  FinancialMarker,
  FinancialReceipt,
  InvoiceReceipt,
  Period,
} from '@tradinggoose/billing'
import { financialFingerprint } from '@tradinggoose/billing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  drain: vi.fn(),
  prepare: vi.fn(),
  advance: vi.fn(),
  issued: vi.fn(),
  payment: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  drainFinancialDispatch: m.drain,
  prepareFinancialContact: m.prepare,
  advanceFinancialDispatch: m.advance,
  acknowledgeInvoiceIssued: m.issued,
  acceptInvoicePayment: m.payment,
}))
vi.mock('@tradinggoose/db', () => ({
  db: { transaction: async (run: (tx: object) => unknown) => run({}) },
}))
vi.mock('@/lib/system-services/stripe-runtime', () => ({
  getStripeServiceConfig: () => ({ secretKey: 'sk_test_disposable_sdk_fixture' }),
}))
vi.mock('@/lib/billing/financial-notifications', () => ({ executeFinancialNotification: vi.fn() }))

import { dispatchFinancialMarkers } from './dispatcher'

const originalPeriod: Period = Object.freeze({
  subscriptionId: 'retained-studio-subscription',
  stripeSubscriptionId: 'sub_original',
  customerId: 'cus_original',
  start: '2026-10-01T00:00:00.000Z',
  end: '2026-11-01T00:00:00.000Z',
})
const root = { type: 'user' as const, id: 'original-owner' }
const namespace = 'billing-usage:user:original-owner'
const fingerprint = 'a'.repeat(64)
const metadata = {
  type: 'overage_billing',
  subtype: 'final',
  financialNamespace: namespace,
  financialKey: 'invoice-original-period',
  financialFingerprint: fingerprint,
  subscriptionId: 'sub_original',
  periodStart: originalPeriod.start!,
  periodEnd: originalPeriod.end!,
}
const paymentMetadata = {
  financialPaymentMethod: 'pm_subscription',
  financialPaymentMethodSource: 'subscription',
}
type Phase = 'create' | 'item' | 'finalize' | 'pay'
type Contact = {
  url: URL
  method: string
  headers: Headers
  body: URLSearchParams
  signal: AbortSignal | null | undefined
}
type PaymentMethodReference = string | { id: string } | null
type ProviderInvoice = {
  id: string
  object: 'invoice'
  customer: string
  currency: string
  metadata: Record<string, string>
  default_payment_method: PaymentMethodReference
  total: number
  amount_paid: number
  status: 'draft' | 'open' | 'paid'
}
type ProviderSubscription = {
  id: string
  object: 'subscription'
  customer: string | { id: string }
  default_payment_method: PaymentMethodReference
}
type ProviderCustomer = {
  id: string
  object: 'customer'
  deleted?: boolean
  invoice_settings: { default_payment_method: PaymentMethodReference }
}
type ProviderPaymentMethod = {
  id: string
  object: 'payment_method'
  customer: string | { id: string } | null
}
type RequestEnvelope = {
  version: 1
  stage: 'request'
  original: {
    namespace: string
    key: string
    intentFingerprint: string
    customerId: string
    subscriptionId: string
    period: Period
    amountCents: string
    invoiceId: string | null
    phase: Phase
  }
  paymentMethod: { id: string; source: 'subscription' | 'customer' }
  request: { operation: Phase; params: Record<string, unknown> }
  requestFingerprint: string
}
let current: DispatchClaim
let deadline: number
let contacts: Contact[]
let order: string[]
let provider: ProviderInvoice
let subscription: ProviderSubscription
let customer: ProviderCustomer
let methods: Record<string, ProviderPaymentMethod>
let reply: (contact: Contact) => Response | Promise<Response>

function receipt(): InvoiceReceipt {
  return {
    recordType: 'invoice',
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: Date.now(),
    markers: [],
    fingerprint,
    root,
    period: originalPeriod,
    amountCents: '1257',
    currency: 'usd',
    invoiceObligationState: 'open',
    issuance: 'pending',
    requestKey: 'stable-original-request-key',
    subtype: 'final',
  }
}
function claim(phase: Phase, intent = receipt(), reconcile = false): DispatchClaim {
  const marker: FinancialMarker = {
    id: 'invoice-marker',
    kind: 'invoice',
    phase,
    state: 'claimed',
    attempts: 1,
    failedAttempts: 0,
    nextAtMs: Date.now(),
    claimId: 'owned-claim',
    claimExpiresAtMs: Date.now() + 120000,
  }
  intent.markers = [structuredClone(marker)]
  return {
    candidate: { namespace, key: metadata.financialKey, due: Date.now() },
    receipt: intent,
    marker,
    root,
    reconcile,
  }
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'request-id': 'req_disposable_fixture' } })
}
function syncMarker(value: DispatchClaim) {
  // Model the canonical JSON round trip, without making the mocked advance clear any fields itself.
  value.receipt.markers = [JSON.parse(JSON.stringify(value.marker))]
}
function envelope(): RequestEnvelope {
  expect(current.marker.payload).toMatchObject({ version: 1, stage: 'request' })
  return current.marker.payload as unknown as RequestEnvelope
}
function economicPath(phase: Phase) {
  return phase === 'create'
    ? '/v1/invoices'
    : phase === 'item'
      ? '/v1/invoiceitems'
      : `/v1/invoices/in_original/${phase === 'finalize' ? 'finalize' : 'pay'}`
}
function posts() {
  return contacts.filter((contact) => contact.method === 'POST')
}
function clearObservations() {
  contacts = []
  order = []
  for (const mock of [m.prepare, m.advance, m.issued, m.payment, m.fetch]) mock.mockClear()
}
function reclaim() {
  current.reconcile = true
  current.marker.attempts += 1
  current.marker.claimId = `reclaimed-${current.marker.attempts}`
  current.marker.claimExpiresAtMs = Date.now() + 120000
  syncMarker(current)
  deadline = Date.now() + 20000
}
function providerReply(contact: Contact): Response {
  const path = contact.url.pathname
  if (contact.method === 'GET' && path === '/v1/subscriptions/sub_original')
    return json(subscription)
  if (contact.method === 'GET' && path === '/v1/customers/cus_original') return json(customer)
  if (contact.method === 'GET' && path.startsWith('/v1/customers/cus_original/payment_methods/')) {
    const id = path.slice(path.lastIndexOf('/') + 1)
    const method = methods[id]
    return method
      ? json(method)
      : json({ error: { type: 'invalid_request_error', message: 'Missing original method' } }, 404)
  }
  if (contact.method === 'GET' && path === '/v1/invoices')
    return json({ object: 'list', data: [provider], has_more: false, url: '/v1/invoices' })
  if (contact.method === 'GET' && path === '/v1/invoices/in_original') return json(provider)
  if (contact.method === 'POST' && path === '/v1/invoices') {
    provider = {
      ...provider,
      default_payment_method: contact.body.get('default_payment_method'),
      metadata: {
        ...metadata,
        financialPaymentMethod: contact.body.get('metadata[financialPaymentMethod]') ?? '',
        financialPaymentMethodSource:
          contact.body.get('metadata[financialPaymentMethodSource]') ?? '',
      },
    }
    return json(provider)
  }
  if (contact.method === 'POST' && path === '/v1/invoiceitems')
    return json({
      id: 'ii_original',
      object: 'invoiceitem',
      invoice: 'in_original',
      customer: 'cus_original',
      amount: 1257,
      currency: 'usd',
      metadata,
    })
  if (contact.method === 'GET' && path === '/v1/invoiceitems')
    return json({
      object: 'list',
      data: [{ id: 'ii_original', metadata }],
      has_more: false,
      url: '/v1/invoiceitems',
    })
  if (contact.method === 'POST' && path === '/v1/invoices/in_original/finalize') {
    provider = { ...provider, status: 'open', total: 1257 }
    return json(provider)
  }
  if (contact.method === 'POST' && path === '/v1/invoices/in_original/pay') {
    provider = { ...provider, status: 'paid', amount_paid: 1257 }
    return json(provider)
  }
  throw new Error(`Unexpected fake provider request ${contact.method} ${path}`)
}
async function seedUncertain(phase: Phase, intent: InvoiceReceipt = receipt(), committed = false) {
  current = claim(phase, intent)
  let attempted: { body: string; key: string | null } | undefined
  reply = (contact) => {
    if (contact.method === 'POST' && contact.url.pathname === economicPath(phase)) {
      attempted = { body: contact.body.toString(), key: contact.headers.get('idempotency-key') }
      if (committed) providerReply(contact)
      throw Object.assign(new Error('Lost acknowledgement'), { code: 'ECONNRESET' })
    }
    return providerReply(contact)
  }
  await expect(dispatchFinancialMarkers()).rejects.toThrow()
  expect(posts()).toHaveLength(1)
  expect(attempted).toBeDefined()
  const payload = structuredClone(envelope())
  const firstContactAtMs = current.marker.firstContactAtMs
  expect(firstContactAtMs).toBe(Date.now())
  current = structuredClone(current)
  reclaim()
  clearObservations()
  reply = providerReply
  return { payload, firstContactAtMs, attempted: attempted! }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-08T00:00:00.000Z'))
  current = claim('create')
  deadline = Date.now() + 20000
  contacts = []
  order = []
  subscription = {
    id: 'sub_original',
    object: 'subscription',
    customer: 'cus_original',
    default_payment_method: 'pm_subscription',
  }
  customer = {
    id: 'cus_original',
    object: 'customer',
    invoice_settings: { default_payment_method: 'pm_customer' },
  }
  methods = {
    pm_subscription: { id: 'pm_subscription', object: 'payment_method', customer: 'cus_original' },
    pm_customer: { id: 'pm_customer', object: 'payment_method', customer: 'cus_original' },
  }
  provider = {
    id: 'in_original',
    object: 'invoice',
    customer: 'cus_original',
    currency: 'usd',
    metadata: { ...metadata, ...paymentMetadata },
    default_payment_method: 'pm_subscription',
    total: 1257,
    amount_paid: 0,
    status: 'draft',
  }
  reply = providerReply
  m.drain.mockImplementation(async (_db, options: FinancialDispatchDrainOptions) =>
    options.execute(current, deadline)
  )
  m.prepare.mockImplementation(
    async (
      _tx,
      value: DispatchClaim,
      input: {
        provider: string
        requestKey: string
        fingerprint: string
        now: number
        payload?: Record<string, unknown>
      }
    ) => {
      // Preserve the selected public prepare contract: immutable outer identity, first contact,
      // and shallow payload merge. These narrow mocks are not PostgreSQL claim-CAS evidence.
      if (value.marker.requestKey && value.marker.requestKey !== input.requestKey)
        throw new Error('Prepared request key changed')
      if (value.marker.requestFingerprint && value.marker.requestFingerprint !== input.fingerprint)
        throw new Error('Prepared outer fingerprint changed')
      if (value.marker.provider && value.marker.provider !== input.provider)
        throw new Error('Prepared provider changed')
      order.push(`persist:${value.marker.phase}:${input.payload ? 'request' : 'identity'}`)
      value.marker.firstContactAtMs ??= input.now
      value.marker.requestKey = input.requestKey
      value.marker.requestFingerprint = input.fingerprint
      value.marker.provider = 'stripe'
      if (input.payload)
        value.marker.payload = structuredClone({ ...value.marker.payload, ...input.payload })
      syncMarker(value)
    }
  )
  m.advance.mockImplementation(
    async (
      _tx,
      value: DispatchClaim,
      update: (receipt: FinancialReceipt, marker: FinancialMarker) => void
    ) => {
      order.push(`advance:${value.marker.phase}`)
      update(value.receipt, value.marker)
      syncMarker(value)
      return true
    }
  )
  m.issued.mockImplementation(async () => {
    order.push('issued')
  })
  m.payment.mockImplementation(async () => {
    order.push('payment')
  })
  m.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const contact = {
      url: new URL(input.toString()),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: new URLSearchParams(String(init?.body ?? '')),
      signal: init?.signal,
    }
    expect(order.some((event) => event.startsWith(`persist:${current.marker.phase}:`))).toBe(true)
    expect(contact.url.origin).toBe('https://api.stripe.com')
    if (contact.method === 'POST') {
      const prepared = envelope()
      expect(prepared.original).toEqual({
        namespace,
        key: metadata.financialKey,
        intentFingerprint: fingerprint,
        customerId: 'cus_original',
        subscriptionId: 'sub_original',
        period: originalPeriod,
        amountCents: '1257',
        invoiceId:
          current.receipt.recordType === 'invoice' ? (current.receipt.invoiceId ?? null) : null,
        phase: current.marker.phase,
      })
      expect(prepared.request.operation).toBe(current.marker.phase)
      expect(prepared.requestFingerprint).toBe(financialFingerprint(prepared.request))
      expect(prepared.paymentMethod.id).toEqual(expect.any(String))
      expect(['subscription', 'customer']).toContain(prepared.paymentMethod.source)
      expect(order).toContain(`persist:${current.marker.phase}:request`)
    }
    order.push(`http:${contact.method}:${contact.url.pathname}`)
    contacts.push(contact)
    return reply(contact)
  })
  vi.stubGlobal('fetch', m.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('installed Stripe18.5 financial dispatcher transport/orchestration', () => {
  it('pins the original subscription method before create and pays that method after customer defaults change', async () => {
    let intent = receipt()
    for (const phase of ['create', 'item', 'finalize', 'pay'] as const) {
      current = claim(phase, intent)
      await dispatchFinancialMarkers()
      if (current.receipt.recordType !== 'invoice') throw new Error('Fixture receipt changed')
      intent = current.receipt
      if (phase !== 'pay') expect(intent.invoiceId).toBe('in_original')
      if (phase === 'item' || phase === 'finalize') expect(intent.itemId).toBe('ii_original')
      expect(intent.period).toEqual(originalPeriod)
      expect(intent).toMatchObject({
        root,
        fingerprint,
        requestKey: 'stable-original-request-key',
        amountCents: '1257',
        currency: 'usd',
      })
      if (phase !== 'pay') {
        for (const field of [
          'firstContactAtMs',
          'requestKey',
          'requestFingerprint',
          'provider',
          'payload',
        ] as const)
          expect(current.marker[field]).toBeUndefined()
        expect(intent.markers[0]?.payload).toBeUndefined()
      }
      // Later phases must use the invoice's frozen method, not these newer defaults.
      subscription.default_payment_method = 'pm_new_subscription'
      customer.invoice_settings.default_payment_method = 'pm_new_customer'
    }
    const post = posts()
    expect(post.map((value) => value.url.pathname)).toEqual([
      '/v1/invoices',
      '/v1/invoiceitems',
      '/v1/invoices/in_original/finalize',
      '/v1/invoices/in_original/pay',
    ])
    expect(
      contacts.slice(0, 4).map((contact) => `${contact.method}:${contact.url.pathname}`)
    ).toEqual([
      'GET:/v1/subscriptions/sub_original',
      'GET:/v1/customers/cus_original',
      'GET:/v1/customers/cus_original/payment_methods/pm_subscription',
      'POST:/v1/invoices',
    ])
    expect(
      contacts.filter((contact) => contact.url.pathname.startsWith('/v1/subscriptions/'))
    ).toHaveLength(1)
    expect(
      contacts.filter((contact) => contact.url.pathname.startsWith('/v1/customers/'))
    ).toHaveLength(2)
    expect(post[0]!.body.get('customer')).toBe('cus_original')
    expect(post[0]!.body.get('auto_advance')).toBe('false')
    expect(post[0]!.body.get('subscription')).toBeNull()
    expect(post[0]!.body.get('default_payment_method')).toBe('pm_subscription')
    expect(post[0]!.body.get('metadata[financialPaymentMethod]')).toBe('pm_subscription')
    expect(post[0]!.body.get('metadata[financialPaymentMethodSource]')).toBe('subscription')
    expect(post[0]!.body.get('metadata[financialFingerprint]')).toBe(fingerprint)
    expect(post[0]!.body.get('metadata[subscriptionId]')).toBe('sub_original')
    expect(post[1]!.body.get('amount')).toBe('1257')
    expect(post[1]!.body.get('invoice')).toBe('in_original')
    expect(post[1]!.body.get('period[start]')).toBe(
      String(Date.parse(originalPeriod.start!) / 1000)
    )
    expect(post[1]!.body.get('period[end]')).toBe(String(Date.parse(originalPeriod.end!) / 1000))
    expect(post[3]!.body.get('payment_method')).toBe('pm_subscription')
    expect(post.map((value) => value.headers.get('idempotency-key'))).toEqual(
      ['create', 'item', 'finalize', 'pay'].map((phase) => `stable-original-request-key:${phase}`)
    )
    expect(m.advance).toHaveBeenCalledTimes(3)
    expect(m.issued).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      namespace,
      metadata.financialKey,
      'in_original'
    )
    expect(m.payment).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      namespace,
      key: metadata.financialKey,
      invoiceId: 'in_original',
      customerId: 'cus_original',
      amountCents: '1257',
      currency: 'usd',
      paid: true,
      fingerprint,
      period: originalPeriod,
    })
    expect(order.indexOf('issued')).toBeLessThan(order.indexOf('payment'))
  })

  it('uses the original customer default only when the original subscription default is actually null', async () => {
    subscription.default_payment_method = null
    await dispatchFinancialMarkers()
    expect(contacts.map((contact) => contact.url.pathname)).toEqual([
      '/v1/subscriptions/sub_original',
      '/v1/customers/cus_original',
      '/v1/customers/cus_original/payment_methods/pm_customer',
      '/v1/invoices',
    ])
    expect(posts()[0]!.body.get('default_payment_method')).toBe('pm_customer')
    expect(posts()[0]!.body.get('metadata[financialPaymentMethodSource]')).toBe('customer')
  })

  it('accepts expanded references only after checking the exact original customer and method identities', async () => {
    subscription.customer = { id: 'cus_original' }
    subscription.default_payment_method = { id: 'pm_subscription' }
    methods.pm_subscription!.customer = { id: 'cus_original' }
    await dispatchFinancialMarkers()
    expect(posts()[0]!.body.get('default_payment_method')).toBe('pm_subscription')
    expect(contacts[2]!.url.pathname).toBe(
      '/v1/customers/cus_original/payment_methods/pm_subscription'
    )
  })

  it.each([
    'subscription-id',
    'subscription-customer',
    'customer-id',
    'deleted-customer',
    'method-id',
    'method-customer',
    'unattached-method',
    'missing-method',
    'both-defaults-null',
    'missing-subscription-default',
  ] as const)(
    'refuses %s without an economic request or fallback to another default',
    async (mode) => {
      if (mode === 'subscription-id') subscription.id = 'sub_foreign'
      if (mode === 'subscription-customer') subscription.customer = 'cus_foreign'
      if (mode === 'customer-id') customer.id = 'cus_foreign'
      if (mode === 'deleted-customer') customer.deleted = true
      if (mode === 'method-id') methods.pm_subscription!.id = 'pm_foreign'
      if (mode === 'method-customer') methods.pm_subscription!.customer = 'cus_foreign'
      if (mode === 'unattached-method') methods.pm_subscription!.customer = null
      if (mode === 'missing-method') methods = {}
      if (mode === 'missing-subscription-default')
        Object.assign(subscription, { default_payment_method: undefined })
      if (mode === 'both-defaults-null') {
        subscription.default_payment_method = null
        customer.invoice_settings.default_payment_method = null
      }
      await expect(dispatchFinancialMarkers()).rejects.toThrow()
      expect(posts()).toHaveLength(0)
      expect(contacts.some((contact) => contact.url.pathname.endsWith('/pm_customer'))).toBe(false)
      expect(m.advance).not.toHaveBeenCalled()
      expect(m.payment).not.toHaveBeenCalled()
    }
  )

  it('a stale first preparation cannot reach any installed SDK contact', async () => {
    const before = structuredClone(current.receipt)
    current.marker.claimId = 'expired-stale-claim'
    m.prepare.mockRejectedValueOnce(new Error('Financial contact claim was lost'))
    await expect(dispatchFinancialMarkers()).rejects.toThrow('Financial contact claim was lost')
    expect(m.prepare).toHaveBeenCalledOnce()
    expect(contacts).toHaveLength(0)
    expect(m.fetch).not.toHaveBeenCalled()
    expect(m.advance).not.toHaveBeenCalled()
    expect(m.issued).not.toHaveBeenCalled()
    expect(m.payment).not.toHaveBeenCalled()
    expect(current.receipt).toEqual(before)
  })

  it('a stale second preparation after read-only method resolution still cannot POST', async () => {
    const persist = m.prepare.getMockImplementation()!
    m.prepare.mockImplementation(async (...args) => {
      if (args[2].payload) throw new Error('Financial contact claim was lost before request')
      return persist(...args)
    })
    await expect(dispatchFinancialMarkers()).rejects.toThrow(
      'Financial contact claim was lost before request'
    )
    expect(contacts.map((contact) => contact.method)).toEqual(['GET', 'GET', 'GET'])
    expect(current.marker.payload).toBeUndefined()
    expect(m.advance).not.toHaveBeenCalled()
    expect(m.payment).not.toHaveBeenCalled()
  })

  it('awaits original identity preparation before the first read-only HTTP contact', async () => {
    const persist = m.prepare.getMockImplementation()!
    let entered!: () => void
    let release!: () => void
    const prepared = new Promise<void>((resolve) => {
      entered = resolve
    })
    const acknowledged = new Promise<void>((resolve) => {
      release = resolve
    })
    m.prepare.mockImplementationOnce(async (...args) => {
      await persist(...args)
      entered()
      await acknowledged
    })
    const running = dispatchFinancialMarkers()
    try {
      await prepared
      expect(current.marker).toMatchObject({
        firstContactAtMs: Date.now(),
        requestKey: 'stable-original-request-key:create',
        provider: 'stripe',
      })
      expect(current.marker.payload).toBeUndefined()
      expect(m.fetch).not.toHaveBeenCalled()
      expect(m.advance).not.toHaveBeenCalled()
    } finally {
      release()
      await running
    }
    expect(contacts).toHaveLength(4)
    expect(contacts[0]!.method).toBe('GET')
    expect(posts()).toHaveLength(1)
  })

  it('awaits the frozen request acknowledgement after lookups and before the economic POST', async () => {
    const persist = m.prepare.getMockImplementation()!
    let entered!: () => void
    let release!: () => void
    const prepared = new Promise<void>((resolve) => {
      entered = resolve
    })
    const acknowledged = new Promise<void>((resolve) => {
      release = resolve
    })
    m.prepare.mockImplementation(async (...args) => {
      await persist(...args)
      if (args[2].payload) {
        entered()
        await acknowledged
      }
    })
    const running = dispatchFinancialMarkers()
    try {
      await prepared
      expect(contacts.map((contact) => contact.method)).toEqual(['GET', 'GET', 'GET'])
      expect(envelope().paymentMethod).toEqual({ id: 'pm_subscription', source: 'subscription' })
      expect(envelope().request.params).toMatchObject({ default_payment_method: 'pm_subscription' })
      expect(posts()).toHaveLength(0)
      expect(m.advance).not.toHaveBeenCalled()
    } finally {
      release()
      await running
    }
    expect(posts()).toHaveLength(1)
    expect(order.indexOf('persist:create:request')).toBeLessThan(
      order.indexOf('http:POST:/v1/invoices')
    )
  })

  it('one phase shares the aggregate20s signal across original invoice retrieval and write', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    current = claim('item', { ...receipt(), invoiceId: 'in_original' })
    await dispatchFinancialMarkers()
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20000)
    expect(contacts).toHaveLength(2)
    expect(contacts[0]!.signal).toBeInstanceOf(AbortSignal)
    expect(contacts[1]!.signal).toBe(contacts[0]!.signal)
  })

  it('the same deadline covers all three original payment-method reads and create', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await dispatchFinancialMarkers()
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20000)
    expect(contacts).toHaveLength(4)
    expect(new Set(contacts.map((contact) => contact.signal)).size).toBe(1)
  })

  it('provider work stops at the shared deadline before a later request can contact Stripe', async () => {
    current = claim('item', { ...receipt(), invoiceId: 'in_original' })
    reply = (contact) => {
      const response = providerReply(contact)
      vi.setSystemTime(deadline + 1)
      return response
    }
    await expect(dispatchFinancialMarkers()).rejects.toThrow('deadline')
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.method).toBe('GET')
    expect(m.advance).not.toHaveBeenCalled()
  })

  it('an original-method lookup failure refuses rather than silently falling back to the customer default', async () => {
    reply = (contact) =>
      contact.url.pathname.endsWith('/pm_subscription')
        ? json({ error: { type: 'api_error', message: 'Disposable method lookup failure' } }, 500)
        : providerReply(contact)
    await expect(dispatchFinancialMarkers()).rejects.toThrow('Disposable method lookup failure')
    expect(contacts).toHaveLength(3)
    expect(posts()).toHaveLength(0)
    expect(contacts.some((contact) => contact.url.pathname.endsWith('/pm_customer'))).toBe(false)
    expect(m.advance).not.toHaveBeenCalled()
  })

  it('ordinary provider500 is not retried automatically with maxNetworkRetries0', async () => {
    reply = (contact) =>
      contact.method === 'POST'
        ? json({ error: { type: 'api_error', message: 'Disposable provider failure' } }, 500)
        : providerReply(contact)
    await expect(dispatchFinancialMarkers()).rejects.toThrow('Disposable provider failure')
    expect(contacts).toHaveLength(4)
    expect(posts()).toHaveLength(1)
    expect(m.advance).not.toHaveBeenCalled()
    expect(m.payment).not.toHaveBeenCalled()
  })

  it.each(['ECONNRESET', 'EPIPE'])(
    'lost %s POST acknowledgement never creates a second economic transport contact',
    async (code) => {
      reply = (contact) => {
        if (contact.method === 'POST')
          throw Object.assign(new Error('Lost acknowledgement'), { code })
        return providerReply(contact)
      }
      await expect(dispatchFinancialMarkers()).rejects.toThrow()
      expect(contacts).toHaveLength(4)
      expect(posts()).toHaveLength(1)
      expect(envelope().paymentMethod).toEqual({ id: 'pm_subscription', source: 'subscription' })
      expect(m.advance).not.toHaveBeenCalled()
      expect(m.payment).not.toHaveBeenCalled()
    }
  )

  it.each(['unprepared', 'identity-only'] as const)(
    'a %s create reconciliation without a frozen request refuses before any HTTP contact',
    async (mode) => {
      current = claim('create', receipt(), true)
      if (mode === 'identity-only') {
        current.marker.firstContactAtMs = Date.now() - 60000
        current.marker.requestKey = 'stable-original-request-key:create'
        current.marker.requestFingerprint = 'b'.repeat(64)
        current.marker.provider = 'stripe'
        syncMarker(current)
      }
      await expect(dispatchFinancialMarkers()).rejects.toThrow()
      expect(contacts).toHaveLength(0)
      expect(m.advance).not.toHaveBeenCalled()
      expect(m.payment).not.toHaveBeenCalled()
    }
  )

  it('reconciles a genuinely prepared lost create under original method/customer/fingerprint after retention expiry without recreating', async () => {
    const seeded = await seedUncertain('create', receipt(), true)
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    reclaim()
    await dispatchFinancialMarkers()
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.method).toBe('GET')
    expect(contacts[0]!.url.searchParams.get('customer')).toBe('cus_original')
    expect(current.receipt).toMatchObject({ invoiceId: 'in_original' })
    expect(current.marker.phase).toBe('item')
    expect(current.marker.payload).toBeUndefined()
    expect(seeded.payload.paymentMethod).toEqual({ id: 'pm_subscription', source: 'subscription' })
  })

  it.each(['empty', 'ambiguous', 'paginated'] as const)(
    'repeated %s creation reconciliation never resends or resolves newer defaults within retention',
    async (mode) => {
      const seeded = await seedUncertain('create', receipt(), true)
      subscription.default_payment_method = 'pm_new_subscription'
      customer.invoice_settings.default_payment_method = 'pm_new_customer'
      reply = () =>
        json({
          object: 'list',
          data:
            mode === 'empty'
              ? []
              : mode === 'ambiguous'
                ? [provider, { ...provider, id: 'second' }]
                : [provider],
          has_more: mode === 'paginated',
        })
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(dispatchFinancialMarkers()).rejects.toThrow('reconciliation')
        expect(current.marker.firstContactAtMs).toBe(seeded.firstContactAtMs)
        expect(current.marker.payload).toEqual(seeded.payload)
        expect(current.marker.requestKey).toBe('stable-original-request-key:create')
        expect(current.receipt).toMatchObject({
          root,
          period: originalPeriod,
          fingerprint,
          amountCents: '1257',
          currency: 'usd',
          invoiceObligationState: 'open',
          issuance: 'pending',
        })
        expect(
          current.receipt.recordType === 'invoice' && current.receipt.invoiceId
        ).toBeUndefined()
        vi.setSystemTime(Date.now() + 120001)
        reclaim()
      }
      expect(Date.now() - seeded.firstContactAtMs!).toBeLessThan(23 * 60 * 60 * 1000)
      expect(contacts).toHaveLength(3)
      expect(
        contacts.every(
          (contact) =>
            contact.method === 'GET' &&
            contact.url.pathname === '/v1/invoices' &&
            contact.url.searchParams.get('customer') === 'cus_original'
        )
      ).toBe(true)
      expect(new Set(m.prepare.mock.calls.map(([, , input]) => input.fingerprint)).size).toBe(1)
      expect(m.advance).not.toHaveBeenCalled()
      expect(m.issued).not.toHaveBeenCalled()
      expect(m.payment).not.toHaveBeenCalled()
    }
  )

  it.each([
    'method',
    'source',
    'body',
    'fingerprint',
    'phase',
    'original-customer',
    'original-invoice',
  ] as const)(
    'a malformed frozen %s envelope refuses before reconciliation contacts',
    async (mode) => {
      await seedUncertain('create', receipt(), true)
      const payload = structuredClone(envelope())
      if (mode === 'method') payload.paymentMethod.id = 'pm_foreign'
      if (mode === 'source') (payload.paymentMethod as { source: string }).source = 'unknown'
      if (mode === 'body') payload.request.params.default_payment_method = 'pm_foreign'
      if (mode === 'fingerprint') payload.requestFingerprint = 'corrupt'
      if (mode === 'phase') payload.original.phase = 'pay'
      if (mode === 'original-customer') payload.original.customerId = 'cus_foreign'
      if (mode === 'original-invoice') payload.original.invoiceId = 'in_foreign'
      current.marker.payload = payload as unknown as Record<string, unknown>
      syncMarker(current)
      await expect(dispatchFinancialMarkers()).rejects.toThrow()
      expect(contacts).toHaveLength(0)
      expect(m.advance).not.toHaveBeenCalled()
      expect(m.payment).not.toHaveBeenCalled()
    }
  )

  it('recovered invoice item retains the actual item ID without duplicate creation', async () => {
    await seedUncertain('item', { ...receipt(), invoiceId: 'in_original' })
    await dispatchFinancialMarkers()
    expect(contacts.map((contact) => contact.method)).toEqual(['GET', 'GET'])
    expect(current.receipt).toMatchObject({ invoiceId: 'in_original', itemId: 'ii_original' })
    expect(current.marker.phase).toBe('finalize')
    expect(current.marker.payload).toBeUndefined()
  })

  it('missing item after original retention expiry remains classified with no item replay', async () => {
    const seeded = await seedUncertain('item', { ...receipt(), invoiceId: 'in_original' })
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    reclaim()
    reply = (contact) =>
      contact.url.pathname === '/v1/invoiceitems'
        ? json({ object: 'list', data: [], has_more: false })
        : providerReply(contact)
    await expect(dispatchFinancialMarkers()).rejects.toThrow('requires reconciliation')
    expect(contacts.every((contact) => contact.method === 'GET')).toBe(true)
    expect(current.marker.payload).toEqual(seeded.payload)
    expect(current.marker.firstContactAtMs).toBe(seeded.firstContactAtMs)
    expect(m.advance).not.toHaveBeenCalled()
  })

  it.each([
    { customer: 'different-customer' },
    { currency: 'eur' },
    { metadata: { ...metadata, ...paymentMetadata, periodStart: 'wrong-period' } },
    {
      metadata: { ...metadata, ...paymentMetadata, financialFingerprint: 'different-fingerprint' },
    },
    { status: 'open', total: 1258 },
  ])(
    'mismatched original invoice %j cannot reach effects or financial acceptance',
    async (delta) => {
      current = claim('pay', { ...receipt(), invoiceId: 'in_original' })
      reply = () => json({ ...provider, ...delta })
      await expect(dispatchFinancialMarkers()).rejects.toThrow('original accepted financial intent')
      expect(contacts).toHaveLength(1)
      expect(m.payment).not.toHaveBeenCalled()
      expect(m.advance).not.toHaveBeenCalled()
    }
  )

  it.each([
    { default_payment_method: 'pm_foreign' },
    { default_payment_method: null },
    { metadata: { ...metadata, financialPaymentMethodSource: 'subscription' } },
    { metadata: { ...metadata, financialPaymentMethod: 'pm_subscription' } },
    { metadata: { ...metadata, ...paymentMetadata, financialPaymentMethodSource: 'unknown' } },
  ])(
    'an invoice without coherent original method binding %j refuses before later effects',
    async (delta) => {
      current = claim('pay', { ...receipt(), invoiceId: 'in_original' })
      reply = () => json({ ...provider, status: 'open', ...delta })
      await expect(dispatchFinancialMarkers()).rejects.toThrow()
      expect(contacts).toHaveLength(1)
      expect(posts()).toHaveLength(0)
      expect(m.payment).not.toHaveBeenCalled()
      expect(m.advance).not.toHaveBeenCalled()
    }
  )

  it('lost pay acknowledgement retries only the frozen method/body/key while current customer defaults change', async () => {
    provider.status = 'open'
    const seeded = await seedUncertain('pay', {
      ...receipt(),
      invoiceId: 'in_original',
      itemId: 'ii_original',
    })
    subscription.default_payment_method = 'pm_new_subscription'
    customer.invoice_settings.default_payment_method = 'pm_new_customer'
    let retry: { body: string; key: string | null } | undefined
    reply = (contact) => {
      if (contact.method === 'POST') {
        retry = { body: contact.body.toString(), key: contact.headers.get('idempotency-key') }
        throw Object.assign(new Error('Repeated lost acknowledgement'), { code: 'EPIPE' })
      }
      return providerReply(contact)
    }
    await expect(dispatchFinancialMarkers()).rejects.toThrow()
    expect(contacts.map((contact) => contact.url.pathname)).toEqual([
      '/v1/invoices/in_original',
      '/v1/invoices/in_original/pay',
    ])
    expect(retry).toEqual(seeded.attempted)
    expect(posts()[0]!.body.get('payment_method')).toBe('pm_subscription')
    expect(current.marker.payload).toEqual(seeded.payload)
    expect(current.marker.firstContactAtMs).toBe(seeded.firstContactAtMs)
    expect(m.payment).not.toHaveBeenCalled()
  })

  it('an unpaid frozen pay after retention expiry is read-only and keeps the uncertain preparation', async () => {
    provider.status = 'open'
    const seeded = await seedUncertain('pay', {
      ...receipt(),
      invoiceId: 'in_original',
      itemId: 'ii_original',
    })
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    reclaim()
    await expect(dispatchFinancialMarkers()).rejects.toThrow('requires reconciliation')
    expect(contacts.map((contact) => contact.method)).toEqual(['GET'])
    expect(current.marker.payload).toEqual(seeded.payload)
    expect(m.payment).not.toHaveBeenCalled()
  })

  it('lost finalize/payment acknowledgements read known provider state without repeating completed effects', async () => {
    await seedUncertain(
      'finalize',
      { ...receipt(), invoiceId: 'in_original', itemId: 'ii_original' },
      true
    )
    await dispatchFinancialMarkers()
    expect(contacts).toHaveLength(1)
    expect(m.issued).toHaveBeenCalledOnce()
    expect(current.marker.payload).toBeUndefined()
    await seedUncertain(
      'pay',
      { ...receipt(), invoiceId: 'in_original', itemId: 'ii_original' },
      true
    )
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    reclaim()
    await dispatchFinancialMarkers()
    expect(contacts).toHaveLength(1)
    expect(contacts.every((contact) => contact.method === 'GET')).toBe(true)
    expect(m.payment).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        key: metadata.financialKey,
        invoiceId: 'in_original',
        period: originalPeriod,
        amountCents: '1257',
      })
    )
    // Canonical accounting, other-debt preservation and actual claim races belong to the PG suite.
  })
})
