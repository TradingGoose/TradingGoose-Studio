/** @vitest-environment node */
import type {
  DispatchClaim,
  FinancialReceipt,
  NotificationReceipt,
  OperationReceipt,
} from '@tradinggoose/billing'
import { financialFingerprint, financialNamespace } from '@tradinggoose/billing'
import * as tables from '@tradinggoose/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  current: null as NotificationReceipt | null,
  source: null as FinancialReceipt | null,
  recipient: {
    id: 'recipient',
    email: 'original@invalid.test',
    name: 'Original',
    enabled: true,
    preferences: null as { unsubscribeAll?: boolean } | null,
  },
  role: 'admin' as string | undefined,
  facts: {
    warning: true,
    upgrade: false,
    planName: 'Original',
    afterPercent: 90,
    afterUsd: '9',
    limitUsd: '10',
  } as object | null,
  render: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
  advance: vi.fn(),
  lock: vi.fn(),
  contact: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: async (run: (tx: unknown) => unknown) =>
      run({
        select: () => {
          let table: unknown
          const q = {
            from(value: unknown) {
              table = value
              return q
            },
            leftJoin() {
              return q
            },
            where() {
              return q
            },
            limit: async () =>
              table === tables.user ? [state.recipient] : state.role ? [{ role: state.role }] : [],
          }
          return q
        },
      }),
  },
}))
vi.mock('@tradinggoose/billing', async (original) => ({
  ...(await original<typeof import('@tradinggoose/billing')>()),
  lockFinancialRoots: (...args: unknown[]) => state.lock(...args),
  readFinancialReceipt: async (_tx: unknown, _ns: string, key: string) =>
    key === state.current?.sourceKey ? state.source : state.current,
  financialUsageNotificationFacts: async () => state.facts,
  prepareFinancialContact: (...args: unknown[]) => state.contact(...args),
  advanceFinancialDispatch: (...args: unknown[]) => state.advance(...args),
}))
vi.mock('@/components/emails/render-email', () => ({
  getEmailSubject: () => 'Original subject',
  renderUsageThresholdEmail: (...args: unknown[]) => state.render(...args),
  renderPaymentFailedEmail: (...args: unknown[]) => state.render(...args),
  renderFreeTierUpgradeEmail: (...args: unknown[]) => state.render(...args),
}))
vi.mock('@/lib/email/locale', () => ({ resolveEmailLocale: async () => 'en' }))
vi.mock('@/lib/email/financial-email', () => ({
  prepareFinancialEmail: (...args: unknown[]) => state.prepare(...args),
  parseFrozenFinancialEmail: (value: unknown) => value,
  sendFinancialEmail: (...args: unknown[]) => state.send(...args),
}))
vi.mock('@/lib/billing/tiers', () => ({
  getPrimaryPublicUserUpgradeTier: async () => null,
  getTierBasePrice: () => {
    throw new Error('No catalogue price')
  },
  getTierUsageAllowanceUsd: () => {
    throw new Error('No catalogue allowance')
  },
}))

import { executeFinancialNotification } from './financial-notifications'

const envelope = {
  version: 1,
  provider: 'resend',
  providerTarget: 'https://api.resend.com',
  recipient: 'original@invalid.test',
  emailType: 'notifications',
  locale: 'en',
  requestJson: '{"fixture":"frozen-original"}',
  fingerprint: 'frozen-original-envelope',
}
function fixture(kind = 'usage-warning', memberUserId: string | null = null) {
  const root = { type: 'organization' as const, id: 'original-organization' }
  const period = {
    subscriptionId: 'original-sub',
    stripeSubscriptionId: 'original-stripe',
    customerId: 'original-customer',
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-02-01T00:00:00.000Z',
  }
  const identity: OperationReceipt['identity'] = {
    root,
    actorUserId: 'original-actor',
    memberUserId,
    scope: memberUserId ? 'organization_member' : 'organization',
    period,
    billingEnabled: true,
    workspaceId: 'original-workspace',
    workflowId: null,
    purpose: 'copilot',
    quote: {
      holdUsd: '1',
      multiplier: '1',
      baseChargeUsd: '0',
      modelUsd: 'unavailable',
      defaultGrant: false,
      billable: true,
    },
  }
  const namespace = financialNamespace(root)
  const sourceKey = 'operation:original-source'
  state.source =
    kind === 'payment-failed'
      ? {
          recordType: 'invoice',
          root,
          period,
          fingerprint: 'original-invoice',
          amountCents: '1000',
          currency: 'usd',
          requestKey: 'original-request',
          subtype: 'subscription',
          invoiceObligationState: 'open',
          issuance: 'issued',
          invoiceId: 'original-invoice',
          financialClosureState: 'open',
          dispatchState: 'complete',
          dispatchAtMs: 0,
          markers: [],
        }
      : {
          recordType: 'operation',
          identity,
          fingerprint: 'original-operation',
          binding: {
            namespace,
            key: 'invocation:original',
            fingerprint: 'original',
            runId: 'original-run',
            actorUserId: identity.actorUserId,
            workspaceId: identity.workspaceId,
            workflowId: null,
            purpose: 'copilot',
          },
          contactState: 'accepted',
          holdState: 'closed',
          appliedUsd: '1',
          modelUsd: 'unavailable',
          financialClosureState: 'open',
          dispatchState: 'pending',
          dispatchAtMs: 0,
          markers: [],
        }
  state.source = structuredClone(state.source)
  const fingerprint = financialFingerprint({
    source: sourceKey,
    recipient: state.recipient.id,
    kind,
  })
  state.current = {
    recordType: 'notification',
    root,
    period,
    fingerprint,
    sourceKey,
    recipientUserId: state.recipient.id,
    notificationKind: kind,
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: 0,
    markers: [
      {
        id: 'original-delivery',
        kind: 'notification',
        phase: 'prepare',
        state: 'claimed',
        attempts: 1,
        failedAttempts: 0,
        nextAtMs: 0,
        claimId: 'original-claim',
        claimExpiresAtMs: Date.now() + 120000,
      },
    ],
  }
  const claim: DispatchClaim = {
    root,
    candidate: { namespace, key: `notification:${fingerprint}`, due: 0 },
    receipt: structuredClone(state.current),
    marker: structuredClone(state.current.markers[0]),
    reconcile: false,
  }
  return claim
}
beforeEach(() => {
  vi.clearAllMocks()
  state.recipient = {
    id: 'recipient',
    email: 'original@invalid.test',
    name: 'Original',
    enabled: true,
    preferences: null,
  }
  state.role = 'admin'
  state.facts = {
    warning: true,
    upgrade: false,
    planName: 'Original',
    afterPercent: 90,
    afterUsd: '9',
    limitUsd: '10',
  }
  state.render.mockResolvedValue('<p>Original rendered body</p>')
  state.prepare.mockResolvedValue({ status: 'ready', envelope })
  state.send.mockResolvedValue({ status: 'accepted', providerId: 'original-provider-id' })
  state.advance.mockImplementation(async (_tx, claim, update) => {
    const marker = state.current!.markers[0]
    if (marker.claimId !== claim.marker.claimId || marker.state !== 'claimed') return false
    update(state.current, marker)
    return true
  })
  state.contact.mockImplementation(async (_tx, claim, input) => {
    const marker = state.current!.markers[0]
    if (marker.claimId !== claim.marker.claimId) throw new Error('Lost contact claim')
    Object.assign(marker, {
      provider: input.provider,
      requestKey: input.requestKey,
      requestFingerprint: input.fingerprint,
      firstContactAtMs: input.now,
      payload: input.payload,
    })
    Object.assign(claim.marker, structuredClone(marker))
  })
})
async function rendering(claim: DispatchClaim) {
  let started!: () => void
  let release!: () => void
  const entered = new Promise<void>((yes) => {
    started = yes
  })
  const gate = new Promise<void>((yes) => {
    release = yes
  })
  state.render.mockImplementation(async () => {
    started()
    await gate
    return '<p>Original rendered body</p>'
  })
  const work = executeFinancialNotification(claim, Date.now() + 20000)
  await entered
  return { work, release }
}
describe('final first financial email contact repeats original source policy', () => {
  it.each([
    'demotion',
    'removal',
    'preferences',
    'email',
    'source-closed',
    'usage-no-longer-eligible',
  ] as const)('suppresses genuinely unsent %s after render without contact', async (change) => {
    const claim = fixture(change === 'source-closed' ? 'payment-failed' : 'usage-warning')
    if (change === 'source-closed') state.role = 'owner'
    const { work, release } = await rendering(claim)
    if (change === 'demotion') state.role = 'member'
    if (change === 'removal') state.role = undefined
    if (change === 'preferences') state.recipient.preferences = { unsubscribeAll: true }
    if (change === 'email') state.recipient.email = 'changed@invalid.test'
    if (change === 'source-closed' && state.source?.recordType === 'invoice')
      state.source.invoiceObligationState = 'closed'
    if (change === 'usage-no-longer-eligible') state.facts = null
    release()
    await expect(work).resolves.toEqual({ outcome: 'complete' })
    expect(state.current!.markers[0].state).toBe('suppressed')
    expect(state.contact).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })
  it.each(['owner', 'admin'] as const)(
    'contacts an unchanged eligible pooled %s once',
    async (role) => {
      const claim = fixture()
      state.role = role
      await executeFinancialNotification(claim, Date.now() + 20000)
      expect(state.contact).toHaveBeenCalledTimes(1)
      expect(state.send).toHaveBeenCalledTimes(1)
    }
  )
  it('keeps the original individual member eligible without adding an owner requirement', async () => {
    const claim = fixture('usage-warning', state.recipient.id)
    state.role = 'member'
    await executeFinancialNotification(claim, Date.now() + 20000)
    expect(state.send).toHaveBeenCalledTimes(1)
  })
  it('refuses a lost claim after render instead of completing or contacting', async () => {
    const claim = fixture()
    const { work, release } = await rendering(claim)
    state.current!.markers[0].claimId = 'new-owner-claim'
    release()
    await expect(work).rejects.toThrow('claim was lost')
    expect(state.contact).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })
  it('refuses conflicting original source binding without rendering or suppressing', async () => {
    const claim = fixture()
    if (state.source?.recordType === 'operation') state.source.identity.root.id = 'foreign-root'
    await expect(executeFinancialNotification(claim, Date.now() + 20000)).rejects.toThrow(
      'source binding'
    )
    expect(state.render).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
    expect(state.advance).not.toHaveBeenCalled()
  })
  it('keeps prepared recovery bytes and contact identity despite later demotion and closed source', async () => {
    const claim = fixture('payment-failed')
    if (claim.receipt.recordType !== 'notification')
      throw new Error('Original notification required')
    state.role = 'member'
    if (state.source?.recordType === 'invoice') state.source.invoiceObligationState = 'closed'
    Object.assign(state.current!.markers[0], {
      firstContactAtMs: Date.now() - 1000,
      provider: 'resend',
      requestKey: `financial-email:${claim.receipt.fingerprint}`,
      requestFingerprint: envelope.fingerprint,
      payload: { envelope, azureOperationId: 'original-operation' },
    })
    claim.marker = structuredClone(state.current!.markers[0])
    claim.reconcile = true
    await executeFinancialNotification(claim, Date.now() + 20000)
    expect(state.render).not.toHaveBeenCalled()
    expect(state.prepare).not.toHaveBeenCalled()
    expect(state.send).toHaveBeenCalledWith(
      envelope,
      expect.objectContaining({ firstContactAtMs: claim.marker.firstContactAtMs, reconcile: true })
    )
  })
  it('partial preparation never becomes newly suppressed unsent work', async () => {
    const claim = fixture()
    state.role = 'member'
    state.current!.markers[0].payload = { envelope }
    claim.marker = structuredClone(state.current!.markers[0])
    await expect(executeFinancialNotification(claim, Date.now() + 20000)).rejects.toThrow(
      'requires classification'
    )
    expect(state.advance).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })
})
