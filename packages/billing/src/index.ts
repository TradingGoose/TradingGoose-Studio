import { createHash, randomUUID } from 'node:crypto'
import * as schema from '@tradinggoose/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import {
  assertFinancialMemberTargets,
  assertPristineFinancialOrganization,
  type MemberRegistrationReceipt,
  type MemberRegistryReceipt,
  readFinancialMemberTarget,
  validateFinancialLedger,
  validateFinancialMemberReceipt,
} from './members'
import {
  addMoney,
  centsToUsd,
  compareMoney,
  type DecimalAmount,
  decimalFromSafeInteger,
  displayPercentage,
  maxMoney,
  minMoney,
  monetary,
  multiplyMoney,
  shiftMoney,
  subtractMoney,
  subtractMoneyClamped,
  usdToCents,
} from './money'
import { assertFinancialStorageReady } from './storage'

export {
  assertFinancialMemberTargets,
  type FinancialMemberPreservationLedger,
  type FinancialMemberProvenance,
  type FinancialMembership,
  initializeFinancialMemberRegistry,
  listFinancialMemberRegistrations,
  type MemberRegistrationReceipt,
  type MemberRegistryReceipt,
  memberRegistrationKey,
  memberRegistrationPredicate,
  memberRegistryKey,
  preserveFinancialMemberRegistry,
  readFinancialMemberTarget,
  registerFinancialMember,
} from './members'
export * from './money'
export * from './storage'

/** This package owns policy, never a pool, model, transcript or provider report. */
export type FinancialTransaction = Pick<
  PostgresJsDatabase<Record<string, never>>,
  'execute' | 'select' | 'insert' | 'update' | 'delete'
>
export type FinancialRoot = { type: 'user' | 'organization'; id: string }
export type FinancialBinding = {
  namespace: string
  key: string
  fingerprint: string
  runId: string
  actorUserId: string
  workspaceId: string | null
  workflowId: string | null
  purpose: string
}
export type ModelOccurrence = { stepNumber: number; retryCount: number; runId?: string }
export class FinancialPolicyError extends Error {
  constructor(
    message: string,
    public status = 409,
    public code?: 'root-busy'
  ) {
    super(message)
    this.name = 'FinancialPolicyError'
  }
}
function fail(message: string, status = 409, code?: 'root-busy'): never {
  throw new FinancialPolicyError(message, status, code)
}
export type DispatchIntegrityCode =
  | 'invalid-schedule'
  | 'invalid-marker'
  | 'incomplete-contact'
  | 'unsupported-phase'
  | 'projection-conflict'
  | 'unprovable-original-owner'
  | 'unprovable-financial-record'
  | 'unprovable-money'
  | 'incomplete-member-basis'
export class FinancialDispatchIntegrityError extends FinancialPolicyError {
  constructor(
    public integrityCode: DispatchIntegrityCode,
    public observedFingerprint: string
  ) {
    super('Financial dispatch evidence requires classification')
    this.name = 'FinancialDispatchIntegrityError'
  }
}
export type DispatchIntegrityReview = {
  code: DispatchIntegrityCode
  observedFingerprint: string
  evidenceFingerprint: string
  reviews: number
  firstObservedAtMs: number
  reviewedAtMs: number
  nextReviewAtMs: number
}
export const BILLING_NAMESPACE_PREFIX = 'billing-usage:'
export const CATALOG_LOCK = 4_126_093
const {
  idempotencyKey,
  organization,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  user,
  userStats,
  member,
  permissions,
  subscription,
  systemBillingTier,
  systemSettings,
  systemBillingSettings,
  workflow,
  workspace,
} = schema
export const outstandingPredicate = sql`${idempotencyKey.namespace} LIKE 'billing-usage:%' AND ${idempotencyKey.result}->>'recordType' = 'operation' AND ${idempotencyKey.result}->>'holdState' = 'outstanding'`
export const dispatchPredicate = sql`${idempotencyKey.namespace} LIKE 'billing-usage:%' AND ${idempotencyKey.result}->>'dispatchState' = 'pending'`
export const dispatchDue = sql<number>`(CASE WHEN ((${idempotencyKey.result}->>'dispatchAtMs') COLLATE "C") ~ '^[0-9]{1,15}$' THEN (${idempotencyKey.result}->>'dispatchAtMs')::bigint ELSE 0::bigint END)`
export const closurePredicate = sql`${idempotencyKey.namespace} LIKE 'billing-usage:%' AND (${idempotencyKey.result}->>'financialClosureState' IS DISTINCT FROM 'closed' OR (${idempotencyKey.result}->>'recordType' = 'operation' AND ${idempotencyKey.result}->>'holdState' = 'outstanding') OR ${idempotencyKey.result}->>'dispatchState' = 'pending' OR ${idempotencyKey.result}->>'invoiceObligationState' = 'open')`
export function financialNamespace(root: FinancialRoot) {
  if (
    !root ||
    (root.type !== 'user' && root.type !== 'organization') ||
    typeof root.id !== 'string'
  )
    fail('Invalid original financial root')
  return `${BILLING_NAMESPACE_PREFIX}${root.type}:${required(root.id)}`
}
function required(value: string): string {
  if (!value || value.length > 512) fail('Invalid financial identity')
  return value
}
export function financialFingerprint(value: unknown): string {
  const stable = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(stable)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, stable(child)])
          )
        : item
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex')
}
export type Period = {
  subscriptionId: string
  stripeSubscriptionId: string | null
  customerId: string | null
  start: string | null
  end: string | null
}
type FinancialIdentity = {
  root: FinancialRoot
  actorUserId: string
  memberUserId: string | null
  scope: 'user' | 'organization' | 'organization_member'
  period: Period | null
  billingEnabled: boolean
  quote: {
    holdUsd: DecimalAmount
    multiplier: DecimalAmount
    modelUsd: 'unavailable'
    baseChargeUsd: DecimalAmount
    defaultGrant: boolean
    billable: boolean
  }
  workspaceId: string | null
  workflowId: string | null
  purpose: string
}
type Closure = { financialClosureState: 'open' | 'closed' }
export type FinancialMarker = {
  id: string
  kind: 'evaluate' | 'invoice' | 'notification'
  phase: string
  state: 'pending' | 'claimed' | 'complete' | 'suppressed' | 'uncertain'
  attempts: number
  failedAttempts: number
  nextAtMs: number
  claimId?: string
  claimExpiresAtMs?: number
  firstContactAtMs?: number
  requestKey?: string
  requestFingerprint?: string
  providerId?: string
  provider?: 'stripe' | 'resend' | 'azure'
  failure?: string
  payload?: Record<string, unknown>
}
type Dispatch = {
  dispatchState: 'pending' | 'complete'
  dispatchAtMs: number
  markers: FinancialMarker[]
  dispatchIntegrity?: DispatchIntegrityReview
}
export type OperationReceipt = Closure &
  Dispatch & {
    recordType: 'operation'
    fingerprint: string
    binding: FinancialBinding
    identity: FinancialIdentity
    holdState: 'outstanding' | 'closed'
    contactState: 'reserved' | 'uncertain' | 'accepted' | 'unused'
    appliedUsd?: DecimalAmount
    acceptanceFingerprint?: string
    modelUsd: 'unavailable'
    acceptedAt?: string
    postedAt?: string
  }
type InvocationReceipt = Closure & {
  recordType: 'invocation'
  fingerprint: string
  binding: FinancialBinding
  identity: FinancialIdentity
}
type Basis = {
  acceptedUsd: DecimalAmount
  copilotUsd: DecimalAmount
  issuedUsd: DecimalAmount
  pendingUsd: DecimalAmount
  memberUsd: Record<string, DecimalAmount>
}
export type PeriodReceipt = Closure &
  Dispatch & {
    recordType: 'period'
    period: Period
    root: FinancialRoot
    commitments: Pick<Basis, 'issuedUsd' | 'pendingUsd'>
    suspension?: {
      allowanceUsd: DecimalAmount
      mode: 'user' | 'pooled' | 'individual'
      defaultGrant: boolean
      capturedAt: string
    }
    closing:
      | null
      | (Omit<Basis, 'issuedUsd' | 'pendingUsd'> & {
          allowanceUsd: DecimalAmount
          mode: 'user' | 'pooled' | 'individual'
          frozenAt: string
          grantBeforeUsd?: DecimalAmount
          grantRemainingUsd?: DecimalAmount
        })
    invoicePrefix: string
  }
type PeriodHead = Closure & {
  recordType: 'period-head'
  root: FinancialRoot
  current: Period | null
  previous: Period | null
}
export type InvoiceReceipt = Closure &
  Dispatch & {
    recordType: 'invoice'
    fingerprint: string
    root: FinancialRoot
    period: Period
    amountCents: DecimalAmount
    currency: 'usd'
    invoiceObligationState: 'open' | 'closed'
    issuance: 'pending' | 'issued'
    invoiceId?: string
    itemId?: string
    requestKey: string
    subtype: 'threshold' | 'final' | 'late_settlement_adjustment' | 'subscription'
  }
export type NotificationReceipt = Closure &
  Dispatch & {
    recordType: 'notification'
    root: FinancialRoot
    period: Period | null
    fingerprint: string
    sourceKey: string
    recipientUserId: string
    notificationKind: string
  }
export type FinancialReceipt =
  | OperationReceipt
  | InvocationReceipt
  | PeriodReceipt
  | PeriodHead
  | InvoiceReceipt
  | NotificationReceipt
  | MemberRegistryReceipt
  | MemberRegistrationReceipt
export const periodKey = (period: Period) => `period:${financialFingerprint(period)}`
const receiptWhere = (namespace: string, key: string) =>
  and(eq(idempotencyKey.namespace, namespace), eq(idempotencyKey.key, key))
export async function readFinancialReceipt(
  tx: FinancialTransaction,
  namespace: string,
  key: string
): Promise<FinancialReceipt | null> {
  if (!namespace.startsWith(BILLING_NAMESPACE_PREFIX)) fail('Financial namespace required')
  const [row] = await tx
    .select({ result: idempotencyKey.result })
    .from(idempotencyKey)
    .where(receiptWhere(namespace, key))
    .limit(1)
  if (!row) return null
  const receipt = row.result as FinancialReceipt
  validateReceiptMoney(receipt)
  if (receipt.recordType === 'member-registry' || receipt.recordType === 'member-registration')
    validateFinancialMemberReceipt(receipt, namespace, key)
  return receipt
}
function validateReceiptMoney(receipt: FinancialReceipt) {
  const exact = (value: unknown) => {
    if (monetary(value) !== value) fail('Financial receipt money must be canonical decimal text')
  }
  if (receipt.recordType === 'invocation' || receipt.recordType === 'operation') {
    for (const value of [
      receipt.identity.quote.holdUsd,
      receipt.identity.quote.multiplier,
      receipt.identity.quote.baseChargeUsd,
    ])
      exact(value)
    if (receipt.recordType === 'operation' && receipt.appliedUsd !== undefined)
      exact(receipt.appliedUsd)
  }
  if (receipt.recordType === 'period') {
    exact(receipt.commitments.issuedUsd)
    exact(receipt.commitments.pendingUsd)
    if (receipt.suspension !== undefined) {
      const retained = receipt.suspension
      if (
        !retained ||
        typeof retained !== 'object' ||
        Object.keys(retained).sort().join(',') !== 'allowanceUsd,capturedAt,defaultGrant,mode' ||
        receipt.closing ||
        typeof retained.defaultGrant !== 'boolean' ||
        (receipt.root.type === 'user'
          ? retained.mode !== 'user'
          : !['pooled', 'individual'].includes(retained.mode) || retained.defaultGrant) ||
        typeof retained.capturedAt !== 'string' ||
        !Number.isFinite(Date.parse(retained.capturedAt)) ||
        new Date(retained.capturedAt).toISOString() !== retained.capturedAt
      )
        fail('Original suspended financial entitlement is invalid')
      exact(retained.allowanceUsd)
    }
    if (receipt.closing) {
      for (const value of [
        receipt.closing.acceptedUsd,
        receipt.closing.copilotUsd,
        receipt.closing.allowanceUsd,
        ...Object.values(receipt.closing.memberUsd),
      ])
        exact(value)
      if (receipt.closing.grantBeforeUsd !== undefined) exact(receipt.closing.grantBeforeUsd)
      if (receipt.closing.grantRemainingUsd !== undefined) exact(receipt.closing.grantRemainingUsd)
    }
  }
  if (receipt.recordType === 'invoice') {
    exact(receipt.amountCents)
    centsToUsd(receipt.amountCents)
  }
  if ('markers' in receipt)
    for (const marker of receipt.markers) {
      if (marker.payload?.beforeUsd !== undefined) exact(marker.payload.beforeUsd)
      if (marker.payload?.afterUsd !== undefined) exact(marker.payload.afterUsd)
    }
}
export async function writeFinancialReceipt(
  tx: FinancialTransaction,
  namespace: string,
  key: string,
  result: FinancialReceipt
) {
  return writeReceipt(tx, namespace, key, result)
}
async function writeReceipt(
  tx: FinancialTransaction,
  namespace: string,
  key: string,
  result: FinancialReceipt,
  eligibilityTransition = false
) {
  validateReceiptMoney(result)
  if (result.recordType === 'member-registry' || result.recordType === 'member-registration')
    validateFinancialMemberReceipt(result, namespace, key)
  if (!namespace.startsWith(BILLING_NAMESPACE_PREFIX)) fail('Financial namespace required')
  const root = 'identity' in result ? result.identity.root : result.root
  if (
    financialNamespace(root) !== namespace ||
    ('binding' in result && result.binding.namespace !== namespace)
  )
    fail('Financial receipt namespace does not match immutable original owner')
  const prior = await readFinancialReceipt(tx, namespace, key)
  if (prior && Object.hasOwn(prior, 'dispatchIntegrity')) {
    const protectedReview = 'dispatchIntegrity' in prior ? prior.dispatchIntegrity : undefined
    if (!('markers' in result) || !Array.isArray(result.markers) || !result.markers.every(object))
      fail('Financial dispatch integrity requires its original readable record')
    if (
      Object.hasOwn(result, 'dispatchIntegrity') &&
      financialFingerprint(result.dispatchIntegrity ?? null) !==
        financialFingerprint(protectedReview ?? null)
    )
      fail('Financial dispatch integrity requires its canonical review')
    Object.assign(result, { dispatchIntegrity: structuredClone(protectedReview) })
    projectDispatch(result)
  } else if (Object.hasOwn(result, 'dispatchIntegrity'))
    fail('Financial dispatch integrity requires its canonical review')
  if (
    result.recordType === 'period' &&
    !eligibilityTransition &&
    financialFingerprint(prior?.recordType === 'period' ? (prior.suspension ?? null) : null) !==
      financialFingerprint(result.suspension ?? null)
  )
    fail('Suspended financial entitlement requires its canonical transition')
  if (prior) {
    if (prior.recordType !== result.recordType) fail('Financial record kind cannot change')
    const immutable = (row: FinancialReceipt): unknown => {
      if (row.recordType === 'member-registry' || row.recordType === 'member-registration')
        return row
      if (row.recordType === 'invocation' || row.recordType === 'operation')
        return {
          recordType: row.recordType,
          fingerprint: row.fingerprint,
          binding: row.binding,
          identity: row.identity,
        }
      if (row.recordType === 'invoice')
        return {
          recordType: row.recordType,
          root: row.root,
          period: row.period,
          fingerprint: row.fingerprint,
          amountCents: row.amountCents,
          currency: row.currency,
          requestKey: row.requestKey,
          subtype: row.subtype,
        }
      if (row.recordType === 'notification')
        return {
          recordType: row.recordType,
          root: row.root,
          period: row.period,
          fingerprint: row.fingerprint,
          sourceKey: row.sourceKey,
          recipientUserId: row.recipientUserId,
          notificationKind: row.notificationKind,
        }
      if (row.recordType === 'period')
        return {
          recordType: row.recordType,
          root: row.root,
          period: row.period,
          invoicePrefix: row.invoicePrefix,
        }
      return { recordType: row.recordType, root: row.root }
    }
    if (financialFingerprint(immutable(prior)) !== financialFingerprint(immutable(result)))
      fail('Original financial identity or accepted invoice intent changed')
    if (
      prior.recordType === 'operation' &&
      result.recordType === 'operation' &&
      (prior.contactState === 'accepted' || prior.contactState === 'unused')
    ) {
      if (
        result.contactState !== prior.contactState ||
        result.holdState !== 'closed' ||
        prior.appliedUsd !== result.appliedUsd ||
        prior.acceptanceFingerprint !== result.acceptanceFingerprint ||
        prior.acceptedAt !== result.acceptedAt ||
        prior.postedAt !== result.postedAt
      )
        fail('Accepted financial operation cannot be repriced or reopened')
    }
    if (prior.recordType === 'period' && result.recordType === 'period') {
      if (
        compareMoney(result.commitments.issuedUsd, prior.commitments.issuedUsd) < 0 ||
        compareMoney(
          addMoney(
            result.commitments.pendingUsd,
            subtractMoney(result.commitments.issuedUsd, prior.commitments.issuedUsd)
          ),
          prior.commitments.pendingUsd
        ) < 0
      )
        fail('Accepted invoice commitments cannot be removed')
      if (prior.closing) {
        const frozen = (closing: NonNullable<PeriodReceipt['closing']>) => ({
          allowanceUsd: closing.allowanceUsd,
          mode: closing.mode,
          frozenAt: closing.frozenAt,
          grantBeforeUsd: closing.grantBeforeUsd,
        })
        if (
          !result.closing ||
          financialFingerprint(frozen(prior.closing)) !==
            financialFingerprint(frozen(result.closing))
        )
          fail('Original closing entitlement cannot change')
      }
    }
    if (
      prior.recordType === 'invoice' &&
      result.recordType === 'invoice' &&
      ((prior.issuance === 'issued' && result.issuance !== 'issued') ||
        (prior.invoiceObligationState === 'closed' && result.invoiceObligationState !== 'closed') ||
        (prior.invoiceId && result.invoiceId !== prior.invoiceId) ||
        (prior.itemId && result.itemId !== prior.itemId))
    )
      fail('Accepted provider invoice progress cannot be replaced')
  }
  await tx
    .insert(idempotencyKey)
    .values({ namespace, key, result })
    .onConflictDoUpdate({ target: [idempotencyKey.key, idempotencyKey.namespace], set: { result } })
}
export async function lockFinancialRoots(
  tx: FinancialTransaction,
  roots: FinancialRoot[],
  options: { skipLocked?: boolean } = {}
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${CATALOG_LOCK}::bigint)`)
  await assertFinancialStorageReady(tx)
  for (const root of [
    ...new Map(roots.map((root) => [financialNamespace(root), root])).values(),
  ].sort((a, b) => financialNamespace(a).localeCompare(financialNamespace(b)))) {
    if (root.type === 'organization') {
      const [anchor] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, root.id))
        .for('update', options.skipLocked ? { skipLocked: true } : undefined)
        .limit(1)
      if (!anchor) {
        const [existing] = options.skipLocked
          ? await tx
              .select({ id: organization.id })
              .from(organization)
              .where(eq(organization.id, root.id))
              .limit(1)
          : []
        fail(
          'Original financial organization is missing or busy',
          409,
          existing ? 'root-busy' : undefined
        )
      }
      await tx
        .select()
        .from(organizationBillingLedger)
        .where(eq(organizationBillingLedger.organizationId, root.id))
        .for('update', options.skipLocked ? { skipLocked: true } : undefined)
      await tx
        .select()
        .from(organizationMemberBillingLedger)
        .where(eq(organizationMemberBillingLedger.organizationId, root.id))
        .orderBy(asc(organizationMemberBillingLedger.userId))
        .for('update', options.skipLocked ? { skipLocked: true } : undefined)
    } else {
      const [anchor] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, root.id))
        .for('update', options.skipLocked ? { skipLocked: true } : undefined)
        .limit(1)
      if (!anchor) {
        const [existing] = options.skipLocked
          ? await tx.select({ id: user.id }).from(user).where(eq(user.id, root.id)).limit(1)
          : []
        fail('Original financial user is missing or busy', 409, existing ? 'root-busy' : undefined)
      }
      await tx
        .select()
        .from(userStats)
        .where(eq(userStats.userId, root.id))
        .for('update', options.skipLocked ? { skipLocked: true } : undefined)
    }
  }
}
async function lockReceiptKeys(tx: FinancialTransaction, namespace: string, keys: string[]) {
  if (keys.length)
    await tx
      .select({ key: idempotencyKey.key })
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.namespace, namespace),
          inArray(idempotencyKey.key, [...new Set(keys)].sort())
        )
      )
      .orderBy(asc(idempotencyKey.key))
      .for('update')
}
async function authorize(
  tx: FinancialTransaction,
  input: { actorUserId: string; workspaceId?: string | null; workflowId?: string | null }
) {
  let workspaceId = input.workspaceId ?? null
  if (input.workflowId) {
    const [row] = await tx.select().from(workflow).where(eq(workflow.id, input.workflowId)).limit(1)
    if (
      !row ||
      (workspaceId && row.workspaceId !== workspaceId) ||
      (!row.workspaceId && row.userId !== input.actorUserId)
    )
      fail('Workflow financial scope denied', 403)
    workspaceId = row.workspaceId
  }
  if (!workspaceId)
    return { root: { type: 'user', id: input.actorUserId } as FinancialRoot, workspaceId: null }
  const [row] = await tx.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
  if (!row) fail('Financial workspace not found', 404)
  if (row.ownerId !== input.actorUserId) {
    const [access] = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.userId, input.actorUserId),
          inArray(permissions.permissionType, ['admin', 'write', 'read'])
        )
      )
      .limit(1)
    if (!access) fail('Financial workspace access denied', 403)
  }
  const root: FinancialRoot =
    row.billingOwnerType === 'organization'
      ? {
          type: 'organization',
          id: row.billingOwnerOrganizationId ?? fail('Organization billing identity missing'),
        }
      : { type: 'user', id: row.billingOwnerUserId ?? fail('Personal billing identity missing') }
  return { root, workspaceId }
}
async function currentPolicy(tx: FinancialTransaction, root: FinancialRoot) {
  const rows = await tx
    .select({ sub: subscription, tier: systemBillingTier })
    .from(subscription)
    .innerJoin(systemBillingTier, eq(subscription.billingTierId, systemBillingTier.id))
    .where(
      and(
        eq(subscription.referenceType, root.type),
        eq(subscription.referenceId, root.id),
        inArray(subscription.status, ['active', 'trialing', 'past_due'])
      )
    )
    .orderBy(asc(subscription.id))
  if (rows.length !== 1) fail('Financial subscription is missing or ambiguous')
  const { sub, tier } = rows[0]
  if (sub.plan !== tier.id || tier.ownerType !== root.type || sub.referenceType !== root.type)
    fail('Financial subscription normalization required')
  const start = sub.periodStart?.toISOString() ?? null
  const end = sub.periodEnd?.toISOString() ?? null
  if (
    (start === null) !== (end === null) ||
    (start && end && start >= end) ||
    (!tier.isDefault && (!start || !end))
  )
    fail('Exact financial period is invalid')
  const period: Period = {
    subscriptionId: sub.id,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    customerId: sub.stripeCustomerId,
    start,
    end,
  }
  return { sub, tier, period }
}
function seatQuantity(value: number | null): DecimalAmount {
  const seats = value === null ? 1 : value
  if (!Number.isSafeInteger(seats) || seats < 1) fail('Financial seat quantity is invalid')
  return decimalFromSafeInteger(seats)
}
function policyEntitlement(root: FinancialRoot, policy: Awaited<ReturnType<typeof currentPolicy>>) {
  return {
    allowanceUsd: multiplyMoney(
      monetary(policy.tier.includedUsageLimitUsd ?? '0'),
      root.type === 'organization' && policy.tier.usageScope === 'pooled'
        ? seatQuantity(policy.sub.seats)
        : '1'
    ),
    mode: root.type === 'user' ? ('user' as const) : policy.tier.usageScope,
    defaultGrant: root.type === 'user' && policy.tier.isDefault,
  }
}
async function originalPeriodSubscription(
  tx: FinancialTransaction,
  root: FinancialRoot,
  expected: Period
) {
  const [original] = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.id, expected.subscriptionId),
        eq(subscription.referenceType, root.type),
        eq(subscription.referenceId, root.id)
      )
    )
    .limit(1)
  if (
    !original ||
    !samePeriod(expected, {
      subscriptionId: original.id,
      stripeSubscriptionId: original.stripeSubscriptionId,
      customerId: original.stripeCustomerId,
      start: original.periodStart?.toISOString() ?? null,
      end: original.periodEnd?.toISOString() ?? null,
    })
  )
    fail('Original suspended subscription identity changed')
}
async function currentPeriodBasis(tx: FinancialTransaction, root: FinancialRoot, expected: Period) {
  const namespace = financialNamespace(root)
  const key = periodKey(expected)
  await lockReceiptKeys(tx, namespace, ['period-head', key])
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  const basis = await readFinancialReceipt(tx, namespace, key)
  if (
    !head ||
    head.recordType !== 'period-head' ||
    !basis ||
    basis.recordType !== 'period' ||
    financialNamespace(head.root) !== namespace ||
    financialNamespace(basis.root) !== namespace ||
    !samePeriod(head.current, expected) ||
    !samePeriod(basis.period, expected)
  )
    fail('Original current financial period basis is missing or conflicting')
  return basis
}
/** Preserve eligibility-derived authority before an adverse same-period status write. */
export async function suspendFinancialPeriodEligibility(
  tx: FinancialTransaction,
  root: FinancialRoot,
  expected: Period
): Promise<PeriodReceipt> {
  await lockFinancialRoots(tx, [root])
  const policy = await currentPolicy(tx, root)
  if (!samePeriod(policy.period, expected)) fail('Financial suspension identity changed')
  const namespace = financialNamespace(root)
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (!head || (head.recordType === 'period-head' && head.current === null))
    await ensureOpenBasis(tx, { root, memberUserId: null }, policy)
  const basis = await currentPeriodBasis(tx, root, expected)
  if (basis.closing) fail('Closed financial identity cannot be suspended or reopened')
  if (basis.suspension) return basis
  basis.suspension = { ...policyEntitlement(root, policy), capturedAt: new Date().toISOString() }
  await writeReceipt(tx, namespace, periodKey(expected), basis, true)
  return basis
}
/** Restore fresh contact after the actual original subscription becomes eligible again. */
export async function resumeFinancialPeriodEligibility(
  tx: FinancialTransaction,
  root: FinancialRoot,
  expected: Period
): Promise<PeriodReceipt> {
  await lockFinancialRoots(tx, [root])
  const policy = await currentPolicy(tx, root)
  if (!samePeriod(policy.period, expected)) fail('Financial restoration identity changed')
  const basis = await currentPeriodBasis(tx, root, expected)
  if (basis.closing) fail('Closed financial identity cannot be reopened')
  if (!basis.suspension) return basis
  const restored = policyEntitlement(root, policy)
  if (
    restored.mode !== basis.suspension.mode ||
    restored.defaultGrant !== basis.suspension.defaultGrant
  )
    fail('Original suspended financial scope or grant category changed')
  basis.suspension = undefined
  await writeReceipt(tx, financialNamespace(root), periodKey(expected), basis, true)
  return basis
}
function samePeriod(a: Period | null, b: Period | null) {
  return financialFingerprint(a) === financialFingerprint(b)
}
function ledgerTargets(identity: Pick<FinancialIdentity, 'root' | 'memberUserId'>) {
  if (identity.root.type === 'user')
    return [{ table: userStats, where: eq(userStats.userId, identity.root.id) }]
  return [
    {
      table: organizationBillingLedger,
      where: eq(organizationBillingLedger.organizationId, identity.root.id),
    },
    ...(identity.memberUserId
      ? [
          {
            table: organizationMemberBillingLedger,
            where: and(
              eq(organizationMemberBillingLedger.organizationId, identity.root.id),
              eq(organizationMemberBillingLedger.userId, identity.memberUserId)
            )!,
          },
        ]
      : []),
  ]
}
async function ledgers(
  tx: FinancialTransaction,
  identity: Pick<FinancialIdentity, 'root' | 'memberUserId'>
) {
  const rows = []
  for (const target of ledgerTargets(identity)) {
    const [row] = await tx
      .select({
        totalCost: target.table.totalCost,
        currentPeriodCost: target.table.currentPeriodCost,
        lastPeriodCost: target.table.lastPeriodCost,
        currentPeriodCopilotCost: target.table.currentPeriodCopilotCost,
        billedOverage:
          'billedOverageThisPeriod' in target.table
            ? target.table.billedOverageThisPeriod
            : sql<string>`'0'`,
        blocked:
          'billingBlocked' in target.table ? target.table.billingBlocked : sql<boolean>`false`,
      })
      .from(target.table)
      .where(target.where)
    if (!row) fail('Required original financial ledger is missing')
    validateFinancialLedger(row)
    rows.push(row)
  }
  return rows
}
function emptyDispatch(): Dispatch {
  return { dispatchState: 'complete', dispatchAtMs: 0, markers: [] }
}
export function projectDispatch<T extends Closure & Dispatch>(receipt: T): T {
  if (Object.hasOwn(receipt, 'dispatchIntegrity')) {
    receipt.dispatchState = 'pending'
    receipt.financialClosureState = 'open'
    receipt.dispatchAtMs = validIntegrityReview(receipt.dispatchIntegrity)
      ? receipt.dispatchIntegrity.nextReviewAtMs
      : 0
    return receipt
  }
  const unfinished = receipt.markers.filter(
    (marker) => marker.state !== 'complete' && marker.state !== 'suppressed'
  )
  receipt.dispatchState = unfinished.length ? 'pending' : 'complete'
  const claimed = unfinished.filter((marker) => marker.state === 'claimed')
  receipt.dispatchAtMs = claimed.length
    ? Math.min(...claimed.map((marker) => marker.claimExpiresAtMs ?? 0))
    : unfinished.length
      ? Math.min(...unfinished.map((marker) => marker.nextAtMs))
      : 0
  if (unfinished.length) receipt.financialClosureState = 'open'
  return receipt
}
function marker(
  kind: FinancialMarker['kind'],
  phase: string,
  now: number,
  id: string
): FinancialMarker {
  return { id, kind, phase, state: 'pending', attempts: 0, failedAttempts: 0, nextAtMs: now }
}
async function ensureOpenBasis(
  tx: FinancialTransaction,
  identity: Pick<FinancialIdentity, 'root' | 'memberUserId'>,
  policy: Awaited<ReturnType<typeof currentPolicy>>
) {
  const namespace = financialNamespace(identity.root)
  const key = periodKey(policy.period)
  await lockReceiptKeys(tx, namespace, ['period-head', key])
  let head = await readFinancialReceipt(tx, namespace, 'period-head')
  const rows = await ledgers(tx, identity)
  if (!head || (head.recordType === 'period-head' && head.current === null)) {
    if (!head) {
      if (identity.root.type === 'organization')
        await assertFinancialMemberTargets(tx, identity.root.id)
      const [evidence] = await tx
        .select({ key: idempotencyKey.key })
        .from(idempotencyKey)
        .where(
          and(
            eq(idempotencyKey.namespace, namespace),
            sql`coalesce(${idempotencyKey.result}->>'recordType', '') NOT IN ('member-registry', 'member-registration')`
          )
        )
        .limit(1)
      if (evidence) fail('Existing financial evidence requires its original verified period head')
    }
    // Only provably fresh zero-money ledgers may initialize online. Existing money needs offline verified preservation.
    if (
      rows.some(
        (row) =>
          monetary(row.totalCost) !== '0' ||
          monetary(row.currentPeriodCost) !== '0' ||
          monetary(row.lastPeriodCost) !== '0'
      )
    )
      fail('Financial period identity requires verified preservation')
    head = {
      recordType: 'period-head',
      root: identity.root,
      current: policy.period,
      previous: null,
      financialClosureState: 'open',
    }
    await writeFinancialReceipt(tx, namespace, 'period-head', head)
  }
  if (head.recordType !== 'period-head' || !samePeriod(head.current, policy.period))
    fail('Financial period transition requires classified closing basis')
  let basis = await readFinancialReceipt(tx, namespace, key)
  if (!basis) {
    basis = {
      recordType: 'period',
      period: policy.period,
      root: identity.root,
      commitments: { issuedUsd: monetary(rows[0].billedOverage), pendingUsd: '0' },
      closing: null,
      invoicePrefix: `invoice:${financialFingerprint(policy.period)}:`,
      financialClosureState: 'open',
      ...emptyDispatch(),
    }
    await writeFinancialReceipt(tx, namespace, key, basis)
  }
  if (basis.recordType !== 'period' || basis.closing || basis.suspension)
    fail('Open financial basis is invalid')
  return basis
}
export async function probeFinancialBackpressure(tx: FinancialTransaction, now = Date.now()) {
  const rows = await tx
    .select({ due: dispatchDue })
    .from(idempotencyKey)
    .where(and(dispatchPredicate, sql`${dispatchDue} <= ${now}::bigint`))
    .orderBy(dispatchDue, asc(idempotencyKey.namespace), asc(idempotencyKey.key))
    .limit(9)
  return {
    blocked: rows.length >= 9 || (!!rows.length && now - Number(rows[0].due) > 300_000),
    dueHeads: rows.length,
    oldestAtMs: rows.length ? Number(rows[0].due) : null,
  }
}
async function assertNoDispatchIntegrity(tx: FinancialTransaction, namespace: string) {
  const [blocked] = await tx
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(
      and(
        eq(idempotencyKey.namespace, namespace),
        closurePredicate,
        sql`${idempotencyKey.result}->'dispatchIntegrity' IS NOT NULL`
      )
    )
    .limit(1)
  if (blocked) fail('Original financial integrity blocks new contact', 503)
}
export async function createInvocation(
  tx: FinancialTransaction,
  input: {
    actorUserId: string
    workspaceId?: string | null
    workflowId?: string | null
    runId: string
    purpose: string
    operationKey: string
    quotedHoldUsd?: DecimalAmount
    billable?: boolean
    schedulerReady: boolean
  }
): Promise<FinancialBinding> {
  required(input.runId)
  required(input.operationKey)
  required(input.purpose)
  if (input.billable === false && input.purpose !== 'workflow-execution')
    fail('Nonbillable financial execution requires the workflow terminal policy')
  const initial = await authorize(tx, input)
  await lockFinancialRoots(tx, [initial.root])
  const fresh = await authorize(tx, input)
  if (financialNamespace(initial.root) !== financialNamespace(fresh.root))
    fail('Financial owner changed while waiting')
  const [settings] = await tx
    .select({ billingEnabled: systemSettings.billingEnabled })
    .from(systemSettings)
    .where(eq(systemSettings.id, 'global'))
    .limit(1)
  const billingEnabled = settings?.billingEnabled ?? false
  const policy = billingEnabled ? await currentPolicy(tx, fresh.root) : null
  const memberUserId =
    policy && fresh.root.type === 'organization' && policy.tier.usageScope === 'individual'
      ? input.actorUserId
      : null
  if (fresh.root.type === 'organization') {
    const [membership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, fresh.root.id), eq(member.userId, input.actorUserId)))
      .limit(1)
    if (!membership) fail('Authenticated financial member is not in the organization', 403)
    await readFinancialMemberTarget(tx, fresh.root.id, input.actorUserId)
  }
  const [fixedSettings] = await tx
    .select()
    .from(systemBillingSettings)
    .where(eq(systemBillingSettings.id, 'global'))
    .limit(1)
  const identity: FinancialIdentity = {
    root: fresh.root,
    actorUserId: input.actorUserId,
    memberUserId,
    scope:
      fresh.root.type === 'user' ? 'user' : memberUserId ? 'organization_member' : 'organization',
    period: policy?.period ?? null,
    billingEnabled,
    quote: {
      holdUsd: monetary(
        input.billable === false && input.purpose === 'workflow-execution'
          ? '0'
          : (input.quotedHoldUsd ?? '1')
      ),
      multiplier: policy
        ? monetary(
            input.purpose === 'copilot'
              ? policy.tier.copilotCostMultiplier
              : policy.tier.workflowModelCostMultiplier
          )
        : '1',
      modelUsd: 'unavailable',
      defaultGrant: policy?.tier.isDefault ?? false,
      billable: input.billable ?? true,
      baseChargeUsd:
        policy && input.billable !== false
          ? input.purpose === 'workflow-execution'
            ? multiplyMoney(
                monetary(fixedSettings?.workflowExecutionChargeUsd ?? '0'),
                monetary(policy.tier.workflowExecutionMultiplier)
              )
            : input.purpose === 'function-execution'
              ? multiplyMoney(
                  monetary(fixedSettings?.functionExecutionChargeUsd ?? '0'),
                  monetary(policy.tier.functionExecutionMultiplier)
                )
              : '0'
          : '0',
    },
    workspaceId: fresh.workspaceId,
    workflowId: input.workflowId ?? null,
    purpose: input.purpose,
  }
  const namespace = financialNamespace(fresh.root)
  const key = `invocation:${input.operationKey}`
  const fingerprint = financialFingerprint({ identity, runId: input.runId })
  const binding: FinancialBinding = {
    namespace,
    key,
    fingerprint,
    runId: input.runId,
    actorUserId: input.actorUserId,
    workspaceId: fresh.workspaceId,
    workflowId: input.workflowId ?? null,
    purpose: input.purpose,
  }
  await lockReceiptKeys(tx, namespace, [key])
  if (policy) await ensureOpenBasis(tx, identity, policy)
  const prior = await readFinancialReceipt(tx, namespace, key)
  if (prior) {
    if (prior.recordType !== 'invocation' || prior.fingerprint !== fingerprint)
      fail('Financial invocation key was reused')
    return prior.binding
  }
  if (input.billable !== false) await assertNoDispatchIntegrity(tx, namespace)
  if (
    billingEnabled &&
    input.billable !== false &&
    (!input.schedulerReady || (await probeFinancialBackpressure(tx)).blocked)
  )
    fail('Financial dispatcher is unavailable or backlogged; retry later', 503)
  if (!policy && !(await readFinancialReceipt(tx, namespace, 'period-head'))) {
    const [evidence] = await tx
      .select({ key: idempotencyKey.key })
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.namespace, namespace),
          sql`coalesce(${idempotencyKey.result}->>'recordType', '') NOT IN ('member-registry', 'member-registration')`
        )
      )
      .limit(1)
    const target =
      fresh.root.type === 'user'
        ? { table: userStats, where: eq(userStats.userId, fresh.root.id) }
        : {
            table: organizationBillingLedger,
            where: eq(organizationBillingLedger.organizationId, fresh.root.id),
          }
    const [ledger] = await tx
      .select({
        total: target.table.totalCost,
        current: target.table.currentPeriodCost,
        previous: target.table.lastPeriodCost,
      })
      .from(target.table)
      .where(target.where)
      .limit(1)
    if (
      evidence ||
      (ledger &&
        [ledger.total, ledger.current, ledger.previous].some((value) => monetary(value) !== '0'))
    )
      fail('Missing original financial head requires classified recovery')
    await writeFinancialReceipt(tx, namespace, 'period-head', {
      recordType: 'period-head',
      root: fresh.root,
      current: null,
      previous: null,
      financialClosureState: 'closed',
    })
  }
  await writeFinancialReceipt(tx, namespace, key, {
    recordType: 'invocation',
    binding,
    fingerprint,
    identity,
    financialClosureState: 'closed',
  })
  return binding
}
async function readBoundInvocation(
  tx: FinancialTransaction,
  binding: FinancialBinding
): Promise<InvocationReceipt> {
  const receipt = await readFinancialReceipt(tx, binding.namespace, binding.key)
  if (
    !receipt ||
    receipt.recordType !== 'invocation' ||
    receipt.fingerprint !== binding.fingerprint ||
    financialFingerprint(receipt.binding) !== financialFingerprint(binding) ||
    financialNamespace(receipt.identity.root) !== binding.namespace
  )
    fail('Persisted financial run binding is missing or conflicting', 403)
  return receipt
}
async function boundInvocation(
  tx: FinancialTransaction,
  binding: FinancialBinding
): Promise<InvocationReceipt> {
  const initial = await readBoundInvocation(tx, binding)
  await lockFinancialRoots(tx, [initial.identity.root])
  await lockReceiptKeys(tx, binding.namespace, [binding.key])
  if (initial.identity.root.type === 'organization')
    await readFinancialMemberTarget(tx, initial.identity.root.id, initial.identity.actorUserId)
  return readBoundInvocation(tx, binding)
}
export function occurrenceKey(binding: FinancialBinding, occurrence: ModelOccurrence) {
  if (
    !Number.isSafeInteger(occurrence.stepNumber) ||
    occurrence.stepNumber < 0 ||
    !Number.isSafeInteger(occurrence.retryCount) ||
    occurrence.retryCount < 0 ||
    (occurrence.runId !== undefined && occurrence.runId !== binding.runId)
  )
    fail('Native financial occurrence is invalid')
  return `operation:${financialFingerprint([binding.runId, occurrence.stepNumber, occurrence.retryCount])}`
}
async function individualOutstanding(
  tx: FinancialTransaction,
  namespace: string,
  memberUserId: string,
  holds: { key: string; result: unknown }[]
): Promise<DecimalAmount> {
  const unprovable = () =>
    fail('Outstanding hold has unprovable original financial-record evidence')
  const text = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512
  const candidates = holds.map(({ key, result }) => {
    if (!object(result) || !object(result.identity) || !object(result.binding)) return unprovable()
    const identity = result.identity
    const binding = result.binding
    if (
      result.recordType !== 'operation' ||
      result.holdState !== 'outstanding' ||
      !['reserved', 'uncertain'].includes(String(result.contactState)) ||
      result.financialClosureState !== 'open' ||
      !/^operation:[a-f0-9]{64}$/.test(key) ||
      !object(identity.root) ||
      identity.root.type !== 'organization' ||
      !text(identity.root.id) ||
      financialNamespace({ type: 'organization', id: identity.root.id }) !== namespace ||
      !text(identity.actorUserId) ||
      !(
        (identity.memberUserId === null && identity.scope === 'organization') ||
        (identity.memberUserId === identity.actorUserId && identity.scope === 'organization_member')
      ) ||
      identity.billingEnabled !== true ||
      !financialPeriod(identity.period) ||
      !object(identity.quote) ||
      identity.quote.modelUsd !== 'unavailable' ||
      typeof identity.quote.defaultGrant !== 'boolean' ||
      typeof identity.quote.billable !== 'boolean' ||
      !text(identity.purpose) ||
      ![identity.workspaceId, identity.workflowId].every(
        (value) => value === null || text(value)
      ) ||
      binding.namespace !== namespace ||
      typeof binding.key !== 'string' ||
      !binding.key.startsWith('invocation:') ||
      !text(binding.key.slice('invocation:'.length)) ||
      !text(binding.runId) ||
      binding.actorUserId !== identity.actorUserId ||
      binding.workspaceId !== identity.workspaceId ||
      binding.workflowId !== identity.workflowId ||
      binding.purpose !== identity.purpose ||
      typeof binding.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(binding.fingerprint) ||
      result.fingerprint !== financialFingerprint([binding.fingerprint, key])
    )
      return unprovable()
    try {
      for (const value of [
        identity.quote.holdUsd,
        identity.quote.multiplier,
        identity.quote.baseChargeUsd,
      ])
        if (typeof value !== 'string' || monetary(value) !== value) return unprovable()
    } catch {
      return unprovable()
    }
    return {
      identity,
      binding,
      key: binding.key,
      actorUserId: identity.actorUserId,
      organizationId: identity.root.id,
      amount: monetary(identity.quote.holdUsd),
    }
  })
  // The original root lock also serializes historical acceptance. Read only the
  // exact invocation anchors for outstanding rows, never settled history.
  const keys = [...new Set(candidates.map((candidate) => candidate.key))].sort()
  const originals = new Map<string, { fingerprint: string; proofFingerprint: string }>()
  for (let offset = 0; offset < keys.length; offset += 100) {
    const rows = await tx
      .select({ key: idempotencyKey.key, result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.namespace, namespace),
          inArray(idempotencyKey.key, keys.slice(offset, offset + 100))
        )
      )
    for (const row of rows) {
      if (originals.has(row.key)) return unprovable()
      const original = row.result
      if (
        !object(original) ||
        original.recordType !== 'invocation' ||
        !object(original.binding) ||
        !object(original.identity) ||
        !text(original.binding.runId)
      )
        return unprovable()
      const fingerprint = financialFingerprint({
        identity: original.identity,
        runId: original.binding.runId,
      })
      if (original.fingerprint !== fingerprint || original.binding.fingerprint !== fingerprint)
        return unprovable()
      originals.set(row.key, {
        fingerprint,
        proofFingerprint: financialFingerprint({
          binding: original.binding,
          identity: original.identity,
        }),
      })
    }
  }
  // boundInvocation already proved the current member target. A historical
  // different actor may have departed, but its original target must still exist.
  const provedMembers = new Set([memberUserId])
  for (const { identity, binding, key, actorUserId, organizationId } of candidates) {
    const original = originals.get(key)
    if (
      !original ||
      original.fingerprint !== binding.fingerprint ||
      original.proofFingerprint !== financialFingerprint({ binding, identity })
    )
      return unprovable()
    if (!provedMembers.has(actorUserId)) {
      await readFinancialMemberTarget(tx, organizationId, actorUserId)
      provedMembers.add(actorUserId)
    }
  }
  let total = '0'
  for (let offset = 0; offset < candidates.length; offset += 100)
    total = addMoney(
      total,
      ...candidates
        .slice(offset, offset + 100)
        .map(({ actorUserId, amount }) => (actorUserId === memberUserId ? amount : '0'))
    )
  return total
}
export async function admitModelStep(
  tx: FinancialTransaction,
  binding: FinancialBinding,
  occurrence: ModelOccurrence,
  schedulerReady: boolean
) {
  const invocation = await boundInvocation(tx, binding)
  const key = occurrenceKey(binding, occurrence)
  const identity = invocation.identity
  const fresh = await authorize(tx, {
    actorUserId: binding.actorUserId,
    workspaceId: binding.workspaceId,
    workflowId: binding.workflowId,
  })
  if (financialNamespace(fresh.root) !== binding.namespace)
    fail('Financial invocation no longer has its authorized original route', 403)
  await lockReceiptKeys(tx, binding.namespace, [key])
  if (await readFinancialReceipt(tx, binding.namespace, key))
    fail(
      'This native model occurrence has already been admitted; classify its contact before retry'
    )
  if (identity.quote.billable) await assertNoDispatchIntegrity(tx, binding.namespace)
  if (identity.root.type === 'organization') {
    const liableMemberUserId = identity.memberUserId ?? identity.actorUserId
    const [membership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.organizationId, identity.root.id), eq(member.userId, liableMemberUserId))
      )
      .limit(1)
    if (
      liableMemberUserId !== binding.actorUserId ||
      identity.actorUserId !== binding.actorUserId ||
      !membership
    )
      fail('Authenticated financial member is not in the organization', 403)
  }
  const policy = identity.billingEnabled ? await currentPolicy(tx, identity.root) : null
  if (policy) {
    if (!samePeriod(policy.period, identity.period))
      fail('A fresh model occurrence requires the exact original open financial period')
    if (identity.memberUserId && policy.tier.usageScope !== 'individual')
      fail('Financial member policy changed')
    await ensureOpenBasis(tx, identity, policy)
  }
  if (policy && !(identity.purpose === 'workflow-execution' && identity.quote.billable === false)) {
    if (!schedulerReady || (await probeFinancialBackpressure(tx)).blocked)
      fail('Financial dispatch readiness blocks new contact', 503)
    const rows = await ledgers(tx, identity)
    if (rows.some((row) => row.blocked)) fail('Original financial owner is blocked', 402)
    const holds = await tx
      .select({ key: idempotencyKey.key, result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.namespace, binding.namespace), outstandingPredicate))
    const outstanding = identity.memberUserId
      ? await individualOutstanding(tx, binding.namespace, identity.memberUserId, holds)
      : holds.reduce((total, row) => {
          const hold = row.result as OperationReceipt
          if (!hold.identity || hold.recordType !== 'operation')
            fail('Outstanding financial hold is malformed')
          return addMoney(total, monetary(hold.identity.quote.holdUsd))
        }, '0')
    const baseAllowance = monetary(policy.tier.includedUsageLimitUsd ?? '0')
    let limit = baseAllowance
    if (identity.root.type === 'organization' && !identity.memberUserId) {
      const [org] = await tx
        .select({ limit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, identity.root.id))
      limit = maxMoney(
        multiplyMoney(baseAllowance, seatQuantity(policy.sub.seats)),
        org?.limit === null
          ? '0'
          : monetary(org?.limit ?? fail('Original organization cap is unavailable'))
      )
    } else if (identity.root.type === 'user') {
      const [stats] = await tx
        .select({
          limit: userStats.customUsageLimit,
          grant: userStats.grantedOnboardingAllowanceUsd,
        })
        .from(userStats)
        .where(eq(userStats.userId, identity.root.id))
      if (!stats) fail('Original financial ledger is missing')
      limit = maxMoney(
        baseAllowance,
        stats.limit === null ? '0' : monetary(stats.limit),
        policy.tier.isDefault ? monetary(stats.grant) : '0'
      )
      if (policy.tier.isDefault)
        limit = maxMoney(
          baseAllowance,
          minMoney(limit, addMoney(monetary(rows[0].currentPeriodCost), monetary(stats.grant)))
        )
    }
    if (
      compareMoney(
        addMoney(monetary(rows.at(-1)!.currentPeriodCost), outstanding, identity.quote.holdUsd),
        limit
      ) > 0
    )
      fail('Usage allowance including outstanding holds is exhausted', 402)
  }
  const result: OperationReceipt = {
    recordType: 'operation',
    fingerprint: financialFingerprint([binding.fingerprint, key]),
    binding,
    identity,
    holdState: identity.billingEnabled ? 'outstanding' : 'closed',
    contactState: 'uncertain',
    modelUsd: 'unavailable',
    financialClosureState: identity.billingEnabled ? 'open' : 'closed',
    ...emptyDispatch(),
  }
  await writeFinancialReceipt(tx, binding.namespace, key, result)
  return { namespace: binding.namespace, key }
}
function knownTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const value = usage as Record<string, unknown>
  if (Number.isSafeInteger(value.totalTokens) && Number(value.totalTokens) >= 0)
    return Number(value.totalTokens)
  const input = value.inputTokens
  const output = value.outputTokens
  return Number.isSafeInteger(input) &&
    Number(input) >= 0 &&
    Number.isSafeInteger(output) &&
    Number(output) >= 0
    ? Number(input) + Number(output)
    : undefined
}
export async function acceptModelStep(
  tx: FinancialTransaction,
  binding: FinancialBinding,
  occurrence: ModelOccurrence,
  input: {
    usage?: unknown
    permittedProductUsd?: DecimalAmount
    executionTimeMs?: number
    executionTrigger?: 'manual' | 'api' | 'webhook' | 'schedule' | 'chat'
  } = {}
) {
  const invocation = await readBoundInvocation(tx, binding)
  const key = occurrenceKey(binding, occurrence)
  const identity = invocation.identity
  // Generic native USD has no verified typed contract. Product fixed charges are explicit trusted facts.
  const appliedUsd = monetary(
    input.permittedProductUsd ??
      (identity.purpose === 'function-execution'
        ? shiftMoney(
            multiplyMoney(
              identity.quote.baseChargeUsd,
              decimalFromSafeInteger(
                input.executionTimeMs ?? fail('Function execution duration required')
              )
            ),
            -3
          )
        : identity.purpose === 'workflow-execution'
          ? identity.quote.baseChargeUsd
          : '0')
  )
  if (!identity.quote.billable && appliedUsd !== '0')
    fail('Nonbillable execution cannot accept a charge')
  const acceptanceFingerprint = financialFingerprint({
    appliedUsd,
    executionTrigger: input.executionTrigger ?? null,
  })
  const previous = await readFinancialReceipt(tx, binding.namespace, key)
  if (previous?.recordType === 'operation' && previous.contactState === 'accepted') {
    if (
      previous.fingerprint !== financialFingerprint([binding.fingerprint, key]) ||
      previous.acceptanceFingerprint !== acceptanceFingerprint ||
      previous.appliedUsd !== appliedUsd
    )
      fail('Accepted financial charge intent was changed')
    return previous
  }
  await boundInvocation(tx, binding)
  await lockReceiptKeys(tx, binding.namespace, [
    key,
    'period-head',
    ...(identity.period ? [periodKey(identity.period)] : []),
  ])
  const receipt = await readFinancialReceipt(tx, binding.namespace, key)
  if (
    !receipt ||
    receipt.recordType !== 'operation' ||
    receipt.fingerprint !== financialFingerprint([binding.fingerprint, key])
  )
    fail('Financial model admission is missing')
  if (receipt.contactState === 'accepted') {
    if (
      receipt.acceptanceFingerprint !== acceptanceFingerprint ||
      receipt.appliedUsd !== appliedUsd
    )
      fail('Accepted financial charge intent was changed')
    return receipt
  }
  if (
    receipt.contactState !== 'uncertain' ||
    (identity.billingEnabled && receipt.holdState !== 'outstanding')
  )
    fail('Financial model contact cannot be accepted')
  const tokens = knownTokens(input.usage)
  const now = new Date()
  if (identity.billingEnabled && identity.period) {
    const head = await readFinancialReceipt(tx, binding.namespace, 'period-head')
    const basis = await readFinancialReceipt(tx, binding.namespace, periodKey(identity.period))
    if (
      !head ||
      head.recordType !== 'period-head' ||
      !basis ||
      basis.recordType !== 'period' ||
      financialFingerprint(head.root) !== financialFingerprint(identity.root) ||
      financialFingerprint(basis.root) !== financialFingerprint(identity.root) ||
      !samePeriod(basis.period, identity.period)
    )
      fail('Original financial period basis is missing')
    const beforeRows = await ledgers(tx, identity)
    const current = samePeriod(head.current, identity.period)
    const previous = samePeriod(head.previous, identity.period)
    if (!current && !basis.closing)
      fail('Original closed financial period lacks frozen entitlement')
    if (
      basis.closing &&
      ((identity.root.type === 'user'
        ? basis.closing.mode !== 'user'
        : !['pooled', 'individual'].includes(basis.closing.mode)) ||
        !Number.isFinite(Date.parse(basis.closing.frozenAt)) ||
        new Date(basis.closing.frozenAt).toISOString() !== basis.closing.frozenAt ||
        (identity.memberUserId !== null &&
          !Object.hasOwn(basis.closing.memberUsd, identity.memberUserId)))
    )
      fail('Original frozen financial basis is invalid')
    if (current && basis.suspension) {
      await originalPeriodSubscription(tx, identity.root, identity.period)
      if (
        (identity.memberUserId !== null) !== (basis.suspension.mode === 'individual') ||
        identity.quote.defaultGrant !== basis.suspension.defaultGrant
      )
        fail('Original suspended financial quote scope changed')
    } else if (current && !basis.closing) {
      const policy = await currentPolicy(tx, identity.root)
      if (!samePeriod(policy.period, identity.period))
        fail('Original financial subscription is not coherent')
    }
    for (const target of ledgerTargets(identity)) {
      const counter = input.executionTrigger
        ? {
            manual: target.table.totalManualExecutions,
            api: target.table.totalApiCalls,
            webhook: target.table.totalWebhookTriggers,
            schedule: target.table.totalScheduledExecutions,
            chat: target.table.totalChatExecutions,
          }[input.executionTrigger]
        : undefined
      const counterName = input.executionTrigger
        ? {
            manual: 'totalManualExecutions',
            api: 'totalApiCalls',
            webhook: 'totalWebhookTriggers',
            schedule: 'totalScheduledExecutions',
            chat: 'totalChatExecutions',
          }[input.executionTrigger]
        : undefined
      await tx
        .update(target.table)
        .set({
          ...(counter && counterName ? { [counterName]: sql`${counter} + 1` } : {}),
          totalCost: sql`${target.table.totalCost} + ${appliedUsd}`,
          ...(current
            ? { currentPeriodCost: sql`${target.table.currentPeriodCost} + ${appliedUsd}` }
            : previous
              ? { lastPeriodCost: sql`${target.table.lastPeriodCost} + ${appliedUsd}` }
              : {}),
          ...(tokens !== undefined
            ? { totalTokensUsed: sql`${target.table.totalTokensUsed} + ${tokens}` }
            : {}),
          ...(binding.purpose === 'copilot'
            ? {
                totalCopilotCost: sql`${target.table.totalCopilotCost} + ${appliedUsd}`,
                ...(current
                  ? {
                      currentPeriodCopilotCost: sql`${target.table.currentPeriodCopilotCost} + ${appliedUsd}`,
                    }
                  : previous
                    ? {
                        lastPeriodCopilotCost: sql`${target.table.lastPeriodCopilotCost} + ${appliedUsd}`,
                      }
                    : {}),
                totalCopilotCalls: sql`${target.table.totalCopilotCalls} + 1`,
                ...(tokens !== undefined
                  ? { totalCopilotTokens: sql`${target.table.totalCopilotTokens} + ${tokens}` }
                  : {}),
              }
            : {}),
          lastActive: now,
          ...('updatedAt' in target.table ? { updatedAt: now } : {}),
        })
        .where(target.where)
    }
    if (basis.closing) {
      basis.closing.acceptedUsd = addMoney(basis.closing.acceptedUsd, appliedUsd)
      if (binding.purpose === 'copilot')
        basis.closing.copilotUsd = addMoney(basis.closing.copilotUsd, appliedUsd)
      if (identity.memberUserId)
        basis.closing.memberUsd[identity.memberUserId] = addMoney(
          basis.closing.memberUsd[identity.memberUserId] ?? '0',
          appliedUsd
        )
      await writeFinancialReceipt(tx, binding.namespace, periodKey(identity.period), basis)
    }
    if (
      identity.quote.defaultGrant &&
      identity.root.type === 'user' &&
      compareMoney(appliedUsd, '0') > 0
    ) {
      await tx
        .update(userStats)
        .set({
          grantedOnboardingAllowanceUsd: sql`greatest(0, ${userStats.grantedOnboardingAllowanceUsd} - ${appliedUsd})`,
        })
        .where(eq(userStats.userId, identity.root.id))
    }
    if (compareMoney(appliedUsd, '0') > 0) {
      const evaluation = marker(
        'evaluate',
        current ? 'threshold' : 'late_settlement_adjustment',
        now.getTime(),
        `evaluate:${key}`
      )
      evaluation.payload = { periodKey: periodKey(identity.period) }
      receipt.markers.push(evaluation)
      if (current) {
        const notice = marker(
          'notification',
          'usage-evaluate',
          now.getTime(),
          `usage-notice:${key}`
        )
        notice.payload = {
          beforeUsd: monetary(beforeRows.at(-1)!.currentPeriodCost),
          afterUsd: addMoney(monetary(beforeRows.at(-1)!.currentPeriodCost), appliedUsd),
        }
        receipt.markers.push(notice)
      }
    }
  }
  receipt.appliedUsd = appliedUsd
  receipt.acceptanceFingerprint = acceptanceFingerprint
  receipt.contactState = 'accepted'
  receipt.holdState = 'closed'
  receipt.acceptedAt = now.toISOString()
  receipt.postedAt = now.toISOString()
  receipt.financialClosureState = 'closed'
  projectDispatch(receipt)
  await writeFinancialReceipt(tx, binding.namespace, key, receipt)
  const readback = await readFinancialReceipt(tx, binding.namespace, key)
  if (
    !readback ||
    readback.recordType !== 'operation' ||
    readback.contactState !== 'accepted' ||
    readback.appliedUsd !== appliedUsd
  )
    fail('Financial acceptance readback failed')
  return readback
}
export async function verifyAcceptance(
  tx: FinancialTransaction,
  binding: FinancialBinding,
  occurrence: ModelOccurrence
) {
  await readBoundInvocation(tx, binding)
  const result = await readFinancialReceipt(
    tx,
    binding.namespace,
    occurrenceKey(binding, occurrence)
  )
  if (
    !result ||
    result.recordType !== 'operation' ||
    result.contactState !== 'accepted' ||
    result.holdState !== 'closed' ||
    result.appliedUsd === undefined ||
    result.binding.fingerprint !== binding.fingerprint
  )
    fail('Financial acceptance is not verified')
  return {
    accepted: true as const,
    modelUsd: 'unavailable' as const,
    appliedUsd: result.appliedUsd,
  }
}
export async function releaseProvenUnused(
  tx: FinancialTransaction,
  binding: FinancialBinding,
  occurrence: ModelOccurrence,
  proof: { refusedBeforeDelegation: true }
) {
  await boundInvocation(tx, binding)
  if (proof.refusedBeforeDelegation !== true) fail('Unused contact proof required')
  const key = occurrenceKey(binding, occurrence)
  await lockReceiptKeys(tx, binding.namespace, [key])
  const row = await readFinancialReceipt(tx, binding.namespace, key)
  if (!row || row.recordType !== 'operation' || row.contactState === 'accepted')
    fail('Unused financial operation is invalid')
  row.contactState = 'unused'
  row.holdState = 'closed'
  row.financialClosureState = 'closed'
  await writeFinancialReceipt(tx, binding.namespace, key, row)
}
/** Freeze the last coherent effective basis before any local subscription period overwrite. */
export async function closeFinancialPeriod(
  tx: FinancialTransaction,
  root: FinancialRoot,
  expected: Period
) {
  await lockFinancialRoots(tx, [root])
  if (root.type === 'organization') await assertFinancialMemberTargets(tx, root.id)
  const namespace = financialNamespace(root)
  const key = periodKey(expected)
  const basis = await currentPeriodBasis(tx, root, expected)
  if (basis.closing) return basis
  const policy = basis.suspension ? null : await currentPolicy(tx, root)
  if (policy && !samePeriod(policy.period, expected)) fail('Financial closing identity changed')
  if (basis.suspension) await originalPeriodSubscription(tx, root, expected)
  const entitlement = basis.suspension ?? policyEntitlement(root, policy!)
  const rows = await ledgers(tx, { root, memberUserId: null })
  basis.commitments.issuedUsd = monetary(rows[0].billedOverage)
  let memberUsd: Record<string, DecimalAmount> = {}
  if (entitlement.mode === 'individual') {
    const members = await tx
      .select({
        userId: organizationMemberBillingLedger.userId,
        cost: organizationMemberBillingLedger.currentPeriodCost,
      })
      .from(organizationMemberBillingLedger)
      .where(eq(organizationMemberBillingLedger.organizationId, root.id))
    memberUsd = Object.fromEntries(members.map((row) => [row.userId, monetary(row.cost)]))
  }
  basis.closing = {
    acceptedUsd: monetary(rows[0].currentPeriodCost),
    copilotUsd: monetary(rows[0].currentPeriodCopilotCost),
    memberUsd,
    allowanceUsd: entitlement.allowanceUsd,
    mode: entitlement.mode,
    frozenAt: new Date().toISOString(),
  }
  if (entitlement.defaultGrant && root.type === 'user') {
    const [grant] = await tx
      .select({ remaining: userStats.grantedOnboardingAllowanceUsd })
      .from(userStats)
      .where(eq(userStats.userId, root.id))
      .limit(1)
    const before = monetary(grant?.remaining ?? fail('Original onboarding grant target missing'))
    basis.closing.grantBeforeUsd = before
    basis.closing.grantRemainingUsd = before
  }
  basis.suspension = undefined
  basis.markers.push(marker('evaluate', 'final', Date.now(), `final:${key}`))
  await writeReceipt(tx, namespace, key, projectDispatch(basis), true)
  return basis
}
export async function rotateFinancialPeriod(
  tx: FinancialTransaction,
  root: FinancialRoot,
  next: Period
) {
  await lockFinancialRoots(tx, [root])
  if (root.type === 'organization') await assertFinancialMemberTargets(tx, root.id)
  const policy = await currentPolicy(tx, root)
  if (!samePeriod(policy.period, next))
    fail('Next financial period does not match its effective subscription')
  const namespace = financialNamespace(root)
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (!head || head.recordType !== 'period-head') fail('Financial period head missing at rollover')
  if (samePeriod(head.current, next)) {
    await ensureOpenBasis(tx, { root, memberUserId: null }, policy)
    return
  }
  if (!head.current) fail('Unbilled financial head cannot be rolled over as a paid period')
  const prior = await readFinancialReceipt(tx, namespace, periodKey(head.current))
  if (!prior || prior.recordType !== 'period' || !prior.closing)
    fail('Prior financial period is not frozen')
  head.previous = head.current
  head.current = next
  head.financialClosureState = 'open'
  await writeFinancialReceipt(tx, namespace, 'period-head', head)
  await ensureOpenBasis(tx, { root, memberUserId: null }, policy)
}
export function remainingOverage(
  basis: Basis,
  allowance: DecimalAmount,
  mode: 'user' | 'pooled' | 'individual'
) {
  const overage =
    mode === 'individual'
      ? addMoney(
          ...Object.values(basis.memberUsd).map((cost) =>
            subtractMoneyClamped(monetary(cost), monetary(allowance))
          )
        )
      : subtractMoneyClamped(monetary(basis.acceptedUsd), monetary(allowance))
  return subtractMoneyClamped(
    overage,
    addMoney(monetary(basis.issuedUsd), monetary(basis.pendingUsd))
  )
}
export async function evaluateFinancialPeriod(
  tx: FinancialTransaction,
  namespace: string,
  key: string,
  phase: string
) {
  const initial = await readFinancialReceipt(tx, namespace, key)
  const root = originalDispatchRoot(initial, namespace)
  if (
    !initial ||
    initial.recordType !== 'period' ||
    !root ||
    !financialPeriod(initial.period) ||
    key !== periodKey(initial.period)
  )
    fail('Financial period dispatch target invalid')
  await lockFinancialRoots(tx, [root])
  await assertEvaluationMemberTargets(tx, root, initial)
  await lockReceiptKeys(tx, namespace, [key])
  const receipt = await readFinancialReceipt(tx, namespace, key)
  if (
    !receipt ||
    receipt.recordType !== 'period' ||
    financialFingerprint(receipt.root) !== financialFingerprint(root) ||
    !samePeriod(receipt.period, initial.period) ||
    !Object.hasOwn(receipt, 'closing') ||
    (receipt.closing !== null && !provedClosing(receipt.closing, root))
  )
    fail('Financial period changed')
  const policy =
    receipt.closing || receipt.suspension ? null : await currentPolicy(tx, receipt.root)
  if (policy && !samePeriod(policy.period, receipt.period)) fail('Open invoice identity mismatch')
  if (receipt.suspension) {
    await currentPeriodBasis(tx, receipt.root, receipt.period)
    await originalPeriodSubscription(tx, receipt.root, receipt.period)
  }
  const entitlement =
    receipt.closing ?? receipt.suspension ?? policyEntitlement(receipt.root, policy!)
  const allowance = entitlement.allowanceUsd
  const mode = entitlement.mode
  const rows = await ledgers(tx, { root: receipt.root, memberUserId: null })
  let money: Pick<Basis, 'acceptedUsd' | 'copilotUsd' | 'memberUsd'>
  if (receipt.closing) money = receipt.closing
  else {
    let memberUsd: Record<string, DecimalAmount> = {}
    if (mode === 'individual') {
      const members = await tx
        .select({
          id: organizationMemberBillingLedger.userId,
          cost: organizationMemberBillingLedger.currentPeriodCost,
        })
        .from(organizationMemberBillingLedger)
        .where(eq(organizationMemberBillingLedger.organizationId, receipt.root.id))
      memberUsd = Object.fromEntries(members.map((row) => [row.id, monetary(row.cost)]))
    }
    money = {
      acceptedUsd: monetary(rows[0].currentPeriodCost),
      copilotUsd: monetary(rows[0].currentPeriodCopilotCost),
      memberUsd,
    }
  }
  const invoiceBasis: Basis = { ...money, ...receipt.commitments }
  const [settings] = await tx
    .select()
    .from(systemBillingSettings)
    .where(eq(systemBillingSettings.id, 'global'))
    .limit(1)
  const effectivePhase = receipt.closing
    ? phase === 'late_settlement_adjustment'
      ? phase
      : 'final'
    : 'threshold'
  const remaining = remainingOverage(invoiceBasis, allowance, mode)
  const cents = usdToCents(remaining)
  if (
    !receipt.period.customerId ||
    !receipt.period.stripeSubscriptionId ||
    cents === '0' ||
    (effectivePhase === 'threshold' &&
      compareMoney(remaining, monetary(settings?.overageThresholdDollars ?? '50')) < 0)
  )
    return null
  const intentFingerprint = financialFingerprint({
    period: receipt.period,
    cents,
    currency: 'usd',
    basis: invoiceBasis,
    phase: effectivePhase,
  })
  const invoiceKey = `${receipt.invoicePrefix}${intentFingerprint}`
  await lockReceiptKeys(tx, namespace, [invoiceKey])
  const existing = await readFinancialReceipt(tx, namespace, invoiceKey)
  if (existing) return existing
  const intent: InvoiceReceipt = {
    recordType: 'invoice',
    root: receipt.root,
    period: receipt.period,
    fingerprint: intentFingerprint,
    amountCents: cents,
    currency: 'usd',
    invoiceObligationState: 'open',
    issuance: 'pending',
    requestKey: `billing:${intentFingerprint}`,
    subtype:
      effectivePhase === 'threshold'
        ? 'threshold'
        : effectivePhase === 'final'
          ? 'final'
          : 'late_settlement_adjustment',
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: Date.now(),
    markers: [marker('invoice', 'create', Date.now(), `invoice:${intentFingerprint}`)],
  }
  receipt.commitments.pendingUsd = addMoney(receipt.commitments.pendingUsd, centsToUsd(cents))
  await writeFinancialReceipt(tx, namespace, invoiceKey, intent)
  await writeFinancialReceipt(tx, namespace, key, receipt)
  return intent
}
export async function assertFinancialRootClosed(tx: FinancialTransaction, root: FinancialRoot) {
  if (root.type === 'organization') await assertFinancialMemberTargets(tx, root.id)
  const namespace = financialNamespace(root)
  const [blocker] = await tx
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.namespace, namespace), closurePredicate))
    .orderBy(asc(idempotencyKey.namespace), asc(idempotencyKey.key))
    .limit(1)
  if (blocker)
    fail(
      'Original financial obligations remain unresolved; complete billing recovery before deletion'
    )
  const [evidence] = await tx
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(eq(idempotencyKey.namespace, namespace))
    .limit(1)
  if (!evidence) return
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (!head && root.type === 'organization') {
    await assertPristineFinancialOrganization(tx, root.id)
    return
  }
  if (!head || head.recordType !== 'period-head' || head.financialClosureState !== 'closed')
    fail('Verified financial period closure required')
  for (const period of [head.current, head.previous].filter((p): p is Period => p !== null)) {
    const basis = await readFinancialReceipt(tx, namespace, periodKey(period))
    if (
      !basis ||
      basis.recordType !== 'period' ||
      !basis.closing ||
      basis.financialClosureState !== 'closed'
    )
      fail('Original financial closing basis is incomplete')
  }
}
export type DispatchCandidate = { namespace: string; key: string; due: number }
export async function listFinancialDispatch(
  tx: FinancialTransaction,
  now: number,
  after?: DispatchCandidate,
  limit = 100
): Promise<DispatchCandidate[]> {
  const continuation = after
    ? sql`(${dispatchDue}, ${idempotencyKey.namespace}, ${idempotencyKey.key}) > (${after.due}::bigint, ${after.namespace}, ${after.key})`
    : undefined
  const rows = await tx
    .select({ namespace: idempotencyKey.namespace, key: idempotencyKey.key, due: dispatchDue })
    .from(idempotencyKey)
    .where(and(dispatchPredicate, sql`${dispatchDue} <= ${now}::bigint`, continuation))
    .orderBy(dispatchDue, asc(idempotencyKey.namespace), asc(idempotencyKey.key))
    .limit(Math.min(limit, 100))
  return rows.map((row) => ({ ...row, due: Number(row.due) }))
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function safeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function indexTime(value: unknown): value is number {
  return safeTime(value) && value <= 999_999_999_999_999
}
function integrityEvidence(raw: Record<string, unknown>) {
  const {
    dispatchIntegrity: _review,
    dispatchAtMs: _due,
    dispatchState: _state,
    financialClosureState: _closure,
    ...evidence
  } = raw
  return financialFingerprint(evidence)
}
function validIntegrityReview(value: unknown): value is DispatchIntegrityReview {
  return (
    object(value) &&
    [
      'invalid-schedule',
      'invalid-marker',
      'incomplete-contact',
      'unsupported-phase',
      'projection-conflict',
      'unprovable-original-owner',
      'unprovable-financial-record',
      'unprovable-money',
      'incomplete-member-basis',
    ].includes(String(value.code)) &&
    typeof value.observedFingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(value.observedFingerprint) &&
    typeof value.evidenceFingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(value.evidenceFingerprint) &&
    safeTime(value.reviews) &&
    value.reviews > 0 &&
    safeTime(value.firstObservedAtMs) &&
    safeTime(value.reviewedAtMs) &&
    indexTime(value.nextReviewAtMs) &&
    value.firstObservedAtMs <= value.reviewedAtMs &&
    value.reviewedAtMs <= value.nextReviewAtMs
  )
}
function integrityFault(receipt: unknown, code: DispatchIntegrityCode): never {
  throw new FinancialDispatchIntegrityError(code, financialFingerprint(receipt))
}
async function assertEvaluationMemberTargets(
  tx: FinancialTransaction,
  root: FinancialRoot,
  observed: unknown
) {
  if (root.type !== 'organization') return
  try {
    await assertFinancialMemberTargets(tx, root.id)
  } catch (error) {
    if (error instanceof FinancialPolicyError) integrityFault(observed, 'incomplete-member-basis')
    throw error
  }
}
function hasPendingEvaluation(raw: unknown) {
  return (
    object(raw) &&
    ['operation', 'period'].includes(String(raw.recordType)) &&
    Array.isArray(raw.markers) &&
    raw.markers.some(
      (head) =>
        object(head) &&
        head.kind === 'evaluate' &&
        head.state !== 'complete' &&
        head.state !== 'suppressed'
    )
  )
}
async function rawDispatch(tx: FinancialTransaction, candidate: DispatchCandidate) {
  const [row] = await tx
    .select({ result: idempotencyKey.result })
    .from(idempotencyKey)
    .where(receiptWhere(candidate.namespace, candidate.key))
    .limit(1)
  return row?.result
}
function originalDispatchRoot(raw: unknown, namespace: string): FinancialRoot | null {
  if (!object(raw)) return null
  const value =
    raw.recordType === 'operation' && object(raw.identity) ? raw.identity.root : raw.root
  if (
    !object(value) ||
    !['user', 'organization'].includes(String(value.type)) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 512
  )
    return null
  const root: FinancialRoot = { type: value.type as FinancialRoot['type'], id: value.id }
  return financialNamespace(root) === namespace ? root : null
}
function dispatchMoney(raw: unknown): boolean {
  if (
    !object(raw) ||
    !['operation', 'period', 'invoice', 'notification'].includes(String(raw.recordType))
  )
    return false
  try {
    // Only the monetary validator sees a detached empty marker list when its structure is corrupt.
    // The stored raw contact/marker evidence is never repaired or replaced.
    validateReceiptMoney({
      ...raw,
      markers: Array.isArray(raw.markers) ? raw.markers.filter(object) : [],
    } as FinancialReceipt)
    return true
  } catch {
    return false
  }
}
function dispatchShape(raw: unknown, now: number): DispatchIntegrityCode | null {
  if (!object(raw) || !Array.isArray(raw.markers)) return 'invalid-marker'
  if (!indexTime(raw.dispatchAtMs) || !safeTime(now)) return 'invalid-schedule'
  const ids = new Set<string>()
  let claimed = 0
  for (const value of raw.markers) {
    if (
      !object(value) ||
      typeof value.id !== 'string' ||
      !value.id ||
      ids.has(value.id) ||
      !['evaluate', 'invoice', 'notification'].includes(String(value.kind)) ||
      !['pending', 'claimed', 'complete', 'suppressed', 'uncertain'].includes(
        String(value.state)
      ) ||
      !safeTime(value.attempts) ||
      !safeTime(value.failedAttempts) ||
      !safeTime(value.nextAtMs) ||
      (value.state === 'claimed' &&
        (typeof value.claimId !== 'string' ||
          !value.claimId ||
          !safeTime(value.claimExpiresAtMs) ||
          value.attempts < 1))
    )
      return 'invalid-marker'
    ids.add(value.id)
    if (value.state === 'claimed' && ++claimed > 1) return 'invalid-marker'
    if (
      !indexTime(value.nextAtMs) ||
      (value.state === 'claimed' && !indexTime(value.claimExpiresAtMs))
    )
      return 'invalid-schedule'
    const phases =
      value.kind === 'invoice' && raw.recordType === 'invoice' && raw.subtype !== 'subscription'
        ? ['create', 'item', 'finalize', 'pay']
        : value.kind === 'evaluate' && raw.recordType === 'operation'
          ? ['threshold', 'late_settlement_adjustment']
          : value.kind === 'evaluate' && raw.recordType === 'period'
            ? ['final']
            : value.kind === 'notification' && raw.recordType === 'operation'
              ? ['usage-evaluate']
              : value.kind === 'notification' && raw.recordType === 'invoice'
                ? ['invoice-failure-fanout']
                : value.kind === 'notification' && raw.recordType === 'notification'
                  ? ['prepare']
                  : []
    if (!phases.includes(String(value.phase))) return 'unsupported-phase'
    if (value.kind === 'invoice' && raw.recordType !== 'invoice') return 'invalid-marker'
    if (
      value.kind === 'invoice' ||
      (raw.recordType === 'notification' && value.phase === 'prepare')
    ) {
      const contact = [
        'requestKey',
        'requestFingerprint',
        'provider',
        'firstContactAtMs',
        'providerId',
        'payload',
      ].some((field) => Object.hasOwn(value, field) && value[field] !== undefined)
      if (
        contact &&
        (typeof value.requestKey !== 'string' ||
          !value.requestKey ||
          typeof value.requestFingerprint !== 'string' ||
          !value.requestFingerprint ||
          (value.kind === 'invoice'
            ? value.provider !== 'stripe'
            : !['resend', 'azure'].includes(String(value.provider))) ||
          !safeTime(value.firstContactAtMs) ||
          value.firstContactAtMs > now ||
          (Object.hasOwn(value, 'providerId') &&
            (typeof value.providerId !== 'string' || !value.providerId)) ||
          (Object.hasOwn(value, 'payload') && !object(value.payload)) ||
          (raw.recordType === 'notification' &&
            (!object(value.payload) || !object(value.payload.envelope))))
      )
        return 'incomplete-contact'
      if (!contact && value.state === 'uncertain') return 'incomplete-contact'
    }
  }
  return null
}
async function dispatchReceipt(
  tx: FinancialTransaction,
  candidate: DispatchCandidate,
  now: number
) {
  const raw = await rawDispatch(tx, candidate)
  if (raw === undefined) return null
  if (!originalDispatchRoot(raw, candidate.namespace))
    integrityFault(raw, 'unprovable-original-owner')
  if (!dispatchMoney(raw)) integrityFault(raw, 'unprovable-money')
  if (Object.hasOwn(raw as object, 'dispatchIntegrity')) {
    const review = (raw as Record<string, unknown>).dispatchIntegrity
    integrityFault(raw, validIntegrityReview(review) ? review.code : 'unprovable-financial-record')
  }
  const code = dispatchShape(raw, now)
  if (code) integrityFault(raw, code)
  return raw as FinancialReceipt & Dispatch
}

/** Absence is usable only for a coherent invoice phase; incomplete evidence requires classification. */
function invoiceContactPrepared(
  receipt: FinancialReceipt & Dispatch,
  head: FinancialMarker,
  now: number
): boolean | undefined {
  if (receipt.recordType !== 'invoice' || head.kind !== 'invoice') return undefined
  const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !['create', 'item', 'finalize', 'pay'].includes(head.phase) ||
    !Number.isSafeInteger(head.attempts) ||
    head.attempts < 0 ||
    !Number.isSafeInteger(head.failedAttempts) ||
    head.failedAttempts < 0 ||
    !Number.isSafeInteger(head.nextAtMs) ||
    head.nextAtMs < 0 ||
    (head.state === 'claimed' &&
      (!nonempty(head.claimId) ||
        !Number.isSafeInteger(head.claimExpiresAtMs) ||
        head.claimExpiresAtMs! < 0 ||
        head.attempts < 1))
  )
    integrityFault(receipt, 'invalid-marker')
  const evidence = [
    'requestKey',
    'requestFingerprint',
    'provider',
    'firstContactAtMs',
    'providerId',
    'payload',
  ].some((field) => Object.hasOwn(head, field))
  if (!evidence) return false
  if (
    !nonempty(head.requestKey) ||
    !nonempty(head.requestFingerprint) ||
    head.provider !== 'stripe' ||
    !Number.isSafeInteger(head.firstContactAtMs) ||
    head.firstContactAtMs! < 0 ||
    head.firstContactAtMs! > now ||
    (Object.hasOwn(head, 'providerId') && !nonempty(head.providerId)) ||
    (Object.hasOwn(head, 'payload') &&
      (!head.payload || typeof head.payload !== 'object' || Array.isArray(head.payload)))
  )
    integrityFault(receipt, 'incomplete-contact')
  return true
}
export async function claimFinancialDispatch(
  tx: FinancialTransaction,
  candidate: DispatchCandidate,
  now: number
) {
  const initial = await dispatchReceipt(tx, candidate, now)
  if (!initial) return null
  const root = 'identity' in initial ? initial.identity.root : initial.root
  if (financialNamespace(root) !== candidate.namespace)
    fail('Financial dispatch original owner mismatch')
  try {
    await lockFinancialRoots(tx, [root], { skipLocked: true })
  } catch (error) {
    if (error instanceof FinancialPolicyError && error.code !== 'root-busy')
      integrityFault(initial, 'unprovable-original-owner')
    throw error
  }
  if (hasPendingEvaluation(initial)) {
    const locked = await dispatchReceipt(tx, candidate, now)
    if (!locked) return null
    if (
      financialFingerprint(originalDispatchRoot(locked, candidate.namespace)) !==
      financialFingerprint(root)
    )
      integrityFault(locked, 'unprovable-original-owner')
    const period =
      locked.recordType === 'operation'
        ? locked.identity.period
        : locked.recordType === 'period'
          ? locked.period
          : null
    if (
      !financialPeriod(period) ||
      locked.markers.some(
        (head) =>
          head.kind === 'evaluate' &&
          (locked.recordType === 'operation'
            ? head.payload?.periodKey !== periodKey(period)
            : candidate.key !== periodKey(period))
      )
    )
      integrityFault(locked, 'unprovable-financial-record')
    await assertEvaluationMemberTargets(tx, root, locked)
  }
  await lockReceiptKeys(tx, candidate.namespace, [candidate.key])
  const receipt = await dispatchReceipt(tx, candidate, now)
  if (
    !receipt ||
    !('markers' in receipt) ||
    receipt.dispatchState !== 'pending' ||
    receipt.dispatchAtMs > now
  )
    return null
  const owned = receipt.markers.find((marker) => marker.state === 'claimed')
  if (owned && (owned.claimExpiresAtMs ?? 0) > now) return null
  const head =
    owned ??
    receipt.markers.find(
      (marker) =>
        marker.state !== 'complete' &&
        marker.state !== 'suppressed' &&
        (marker.state === 'claimed'
          ? (marker.claimExpiresAtMs ?? 0) <= now
          : marker.nextAtMs <= now)
    )
  if (!head) integrityFault(receipt, 'projection-conflict')
  const expired = head.state === 'claimed'
  const prepared =
    invoiceContactPrepared(receipt, head, now) ??
    (receipt.recordType === 'notification' ? head.firstContactAtMs !== undefined : undefined)
  if (prepared === false && head.state === 'uncertain')
    integrityFault(receipt, 'incomplete-contact')
  const reconcile = prepared ?? (expired || head.state === 'uncertain')
  head.claimId = randomUUID()
  head.claimExpiresAtMs = now + 120_000
  head.state = 'claimed'
  head.attempts += 1
  await writeFinancialReceipt(tx, candidate.namespace, candidate.key, projectDispatch(receipt))
  return { candidate, receipt, marker: structuredClone(head), reconcile, root }
}
export type DispatchClaim = NonNullable<Awaited<ReturnType<typeof claimFinancialDispatch>>>
export type DispatchClassificationResult =
  | { status: 'classified'; code: DispatchIntegrityCode; nextReviewAtMs: number }
  | { status: 'recovered'; nextAtMs: number }
  | { status: 'busy' | 'stale' }
  | {
      status: 'unresolved'
      reason:
        | 'unprovable-original-owner'
        | 'unprovable-financial-record'
        | 'unprovable-money'
        | 'conflicting-observation'
    }
function financialPeriod(value: unknown): value is Period {
  return (
    object(value) &&
    typeof value.subscriptionId === 'string' &&
    !!value.subscriptionId &&
    ['stripeSubscriptionId', 'customerId', 'start', 'end'].every(
      (key) => value[key] === null || typeof value[key] === 'string'
    ) &&
    ((value.start === null && value.end === null) ||
      (typeof value.start === 'string' &&
        typeof value.end === 'string' &&
        Number.isFinite(Date.parse(value.start)) &&
        Number.isFinite(Date.parse(value.end)) &&
        new Date(value.start).toISOString() === value.start &&
        new Date(value.end).toISOString() === value.end &&
        value.start < value.end))
  )
}
function provedClosing(value: unknown, root: FinancialRoot): boolean {
  return (
    object(value) &&
    object(value.memberUsd) &&
    (root.type === 'user'
      ? value.mode === 'user'
      : ['pooled', 'individual'].includes(String(value.mode))) &&
    typeof value.frozenAt === 'string' &&
    Number.isFinite(Date.parse(value.frozenAt)) &&
    new Date(value.frozenAt).toISOString() === value.frozenAt
  )
}
async function proveDispatchOriginal(
  tx: FinancialTransaction,
  candidate: DispatchCandidate,
  raw: Record<string, unknown>,
  root: FinancialRoot,
  keys: Map<string, string>,
  nested = false
): Promise<boolean> {
  if (
    financialFingerprint(originalDispatchRoot(raw, candidate.namespace)) !==
      financialFingerprint(root) ||
    !dispatchMoney(raw)
  )
    return false
  keys.set(candidate.key, financialFingerprint(raw))
  if (!Array.isArray(raw.markers) || !raw.markers.every(object)) return false
  if (raw.recordType === 'notification') {
    if (
      nested ||
      !Object.hasOwn(raw, 'period') ||
      (raw.period !== null && !financialPeriod(raw.period)) ||
      typeof raw.sourceKey !== 'string' ||
      !raw.sourceKey ||
      typeof raw.recipientUserId !== 'string' ||
      !raw.recipientUserId ||
      !['usage-warning', 'free-tier-upgrade', 'payment-failed'].includes(
        String(raw.notificationKind)
      )
    )
      return false
    const fingerprint = financialFingerprint({
      source: raw.sourceKey,
      recipient: raw.recipientUserId,
      kind: raw.notificationKind,
    })
    if (raw.fingerprint !== fingerprint || candidate.key !== `notification:${fingerprint}`)
      return false
    const sourceCandidate = { ...candidate, key: raw.sourceKey }
    const source = await rawDispatch(tx, sourceCandidate)
    if (
      !object(source) ||
      !['operation', 'invoice'].includes(String(source.recordType)) ||
      (source.recordType === 'operation' &&
        (!object(source.identity) || !Object.hasOwn(source.identity, 'period'))) ||
      (source.recordType === 'invoice' && !financialPeriod(source.period)) ||
      financialFingerprint(
        source.recordType === 'operation' && object(source.identity)
          ? source.identity.period
          : source.period
      ) !== financialFingerprint(raw.period) ||
      (source.recordType === 'operation' && source.contactState !== 'accepted')
    )
      return false
    return proveDispatchOriginal(tx, sourceCandidate, source, root, keys, true)
  }
  let period: unknown = raw.period
  let memberUserId: string | null = null
  if (raw.recordType === 'operation') {
    if (
      !object(raw.binding) ||
      !object(raw.identity) ||
      typeof raw.binding.key !== 'string' ||
      typeof raw.binding.runId !== 'string' ||
      !raw.binding.runId ||
      raw.binding.namespace !== candidate.namespace ||
      raw.binding.fingerprint !==
        financialFingerprint({ identity: raw.identity, runId: raw.binding.runId }) ||
      raw.fingerprint !== financialFingerprint([raw.binding.fingerprint, candidate.key]) ||
      !candidate.key.startsWith('operation:') ||
      !['reserved', 'uncertain', 'accepted', 'unused'].includes(String(raw.contactState)) ||
      !['outstanding', 'closed'].includes(String(raw.holdState))
    )
      return false
    const invocation = await rawDispatch(tx, { ...candidate, key: raw.binding.key })
    if (
      !object(invocation) ||
      invocation.recordType !== 'invocation' ||
      !object(invocation.binding) ||
      !object(invocation.identity) ||
      financialFingerprint(invocation.binding) !== financialFingerprint(raw.binding) ||
      financialFingerprint(invocation.identity) !== financialFingerprint(raw.identity) ||
      invocation.fingerprint !== raw.binding.fingerprint
    )
      return false
    keys.set(raw.binding.key, financialFingerprint(invocation))
    period = raw.identity.period
    if (raw.identity.memberUserId !== null && typeof raw.identity.memberUserId !== 'string')
      return false
    memberUserId = raw.identity.memberUserId as string | null
    if (raw.contactState === 'accepted' && typeof raw.appliedUsd !== 'string') return false
    if (period === null && raw.identity.billingEnabled === false) {
      await ledgers(tx, { root, memberUserId })
      return true
    }
  }
  if (!financialPeriod(period)) return false
  const basisKey = periodKey(period)
  if (
    raw.markers.some(
      (head) =>
        object(head) &&
        head.kind === 'evaluate' &&
        (raw.recordType === 'operation'
          ? !object(head.payload) || head.payload.periodKey !== basisKey
          : raw.recordType !== 'period' || candidate.key !== basisKey)
    )
  )
    return false
  const basis =
    raw.recordType === 'period' ? raw : await rawDispatch(tx, { ...candidate, key: basisKey })
  if (
    !object(basis) ||
    basis.recordType !== 'period' ||
    !financialPeriod(basis.period) ||
    !Object.hasOwn(basis, 'closing') ||
    (basis.closing !== null && !provedClosing(basis.closing, root)) ||
    !dispatchMoney(basis) ||
    financialFingerprint(basis.period) !== financialFingerprint(period) ||
    financialFingerprint(originalDispatchRoot(basis, candidate.namespace)) !==
      financialFingerprint(root) ||
    basis.invoicePrefix !== `invoice:${financialFingerprint(period)}:`
  )
    return false
  keys.set(basisKey, financialFingerprint(basis))
  if (raw.recordType === 'period') {
    const head = await rawDispatch(tx, { ...candidate, key: 'period-head' })
    if (
      !object(head) ||
      head.recordType !== 'period-head' ||
      financialFingerprint(originalDispatchRoot(head, candidate.namespace)) !==
        financialFingerprint(root)
    )
      return false
    keys.set('period-head', financialFingerprint(head))
    for (const slot of [head.current, head.previous]) {
      if (slot === null) continue
      if (!financialPeriod(slot)) return false
      const key = periodKey(slot)
      const linked = key === basisKey ? basis : await rawDispatch(tx, { ...candidate, key })
      if (
        !object(linked) ||
        linked.recordType !== 'period' ||
        !dispatchMoney(linked) ||
        financialFingerprint(linked.period ?? null) !== financialFingerprint(slot) ||
        financialFingerprint(originalDispatchRoot(linked, candidate.namespace)) !==
          financialFingerprint(root) ||
        !Object.hasOwn(linked, 'closing') ||
        (linked.closing !== null && !provedClosing(linked.closing, root))
      )
        return false
      keys.set(key, financialFingerprint(linked))
    }
  }
  const [original] = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.id, period.subscriptionId),
        eq(subscription.referenceType, root.type),
        eq(subscription.referenceId, root.id)
      )
    )
    .limit(1)
  if (
    !original ||
    original.stripeSubscriptionId !== period.stripeSubscriptionId ||
    original.stripeCustomerId !== period.customerId
  )
    return false
  const livePeriod = {
    subscriptionId: original.id,
    stripeSubscriptionId: original.stripeSubscriptionId,
    customerId: original.stripeCustomerId,
    start: original.periodStart?.toISOString() ?? null,
    end: original.periodEnd?.toISOString() ?? null,
  }
  if (!samePeriod(livePeriod, period) && !basis.closing) return false
  await ledgers(tx, { root, memberUserId })
  if (raw.recordType === 'period') return candidate.key === basisKey
  if (raw.recordType === 'operation') return true
  if (
    raw.recordType !== 'invoice' ||
    !period.customerId ||
    !period.stripeSubscriptionId ||
    raw.currency !== 'usd' ||
    typeof raw.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.fingerprint) ||
    !['open', 'closed'].includes(String(raw.invoiceObligationState)) ||
    !['pending', 'issued'].includes(String(raw.issuance)) ||
    typeof raw.amountCents !== 'string' ||
    shiftMoney(centsToUsd(raw.amountCents), 2) !== raw.amountCents
  )
    return false
  if (raw.subtype === 'subscription') {
    if (typeof raw.invoiceId !== 'string' || !raw.invoiceId) return false
    const fingerprint = financialFingerprint({
      root,
      period,
      invoiceId: raw.invoiceId,
      amountCents: raw.amountCents,
      currency: 'usd',
      subtype: 'subscription',
    })
    return (
      raw.fingerprint === fingerprint &&
      candidate.key === `subscription-invoice:${financialFingerprint(raw.invoiceId)}` &&
      raw.requestKey === `stripe-invoice:${raw.invoiceId}`
    )
  }
  return (
    ['threshold', 'final', 'late_settlement_adjustment'].includes(String(raw.subtype)) &&
    candidate.key === `${basis.invoicePrefix}${raw.fingerprint}` &&
    raw.requestKey === `billing:${raw.fingerprint}`
  )
}
/** A review quantum never manufactures a claim, provider identity, money or a replacement phase. */
export async function classifyFinancialDispatch(
  tx: FinancialTransaction,
  candidate: DispatchCandidate,
  observedFingerprint: string,
  now: number
): Promise<DispatchClassificationResult> {
  if (!safeTime(now) || !/^[a-f0-9]{64}$/.test(observedFingerprint))
    return { status: 'unresolved', reason: 'conflicting-observation' }
  const initial = await rawDispatch(tx, candidate)
  if (initial === undefined) return { status: 'stale' }
  if (financialFingerprint(initial) !== observedFingerprint) return { status: 'stale' }
  const root = originalDispatchRoot(initial, candidate.namespace)
  if (!root) return { status: 'unresolved', reason: 'unprovable-original-owner' }
  try {
    await lockFinancialRoots(tx, [root], { skipLocked: true })
  } catch (error) {
    if (error instanceof FinancialPolicyError && error.code === 'root-busy')
      return { status: 'busy' }
    if (error instanceof FinancialPolicyError)
      return { status: 'unresolved', reason: 'unprovable-original-owner' }
    throw error
  }
  let memberBasisComplete = true
  if (hasPendingEvaluation(initial)) {
    try {
      await assertEvaluationMemberTargets(tx, root, initial)
    } catch (error) {
      if (!(error instanceof FinancialDispatchIntegrityError)) throw error
      memberBasisComplete = false
    }
  }
  const keys = new Map<string, string>()
  if (!object(initial) || !dispatchMoney(initial))
    return { status: 'unresolved', reason: 'unprovable-money' }
  let original = false
  try {
    original = await proveDispatchOriginal(tx, candidate, initial, root, keys)
  } catch (error) {
    if (!(error instanceof FinancialPolicyError)) throw error
  }
  if (!original) return { status: 'unresolved', reason: 'unprovable-financial-record' }
  await lockReceiptKeys(tx, candidate.namespace, [...keys.keys()])
  const raw = await rawDispatch(tx, candidate)
  if (!object(raw) || financialFingerprint(raw) !== observedFingerprint) return { status: 'stale' }
  const lockedKeys = new Map<string, string>()
  try {
    if (!(await proveDispatchOriginal(tx, candidate, raw, root, lockedKeys)))
      return { status: 'unresolved', reason: 'unprovable-financial-record' }
  } catch (error) {
    if (!(error instanceof FinancialPolicyError)) throw error
    return { status: 'unresolved', reason: 'unprovable-financial-record' }
  }
  const ordered = (value: Map<string, string>) => [...value].sort(([a], [b]) => a.localeCompare(b))
  if (financialFingerprint(ordered(keys)) !== financialFingerprint(ordered(lockedKeys)))
    return { status: 'stale' }
  if (raw.dispatchState !== 'pending') return { status: 'stale' }
  const indexedDue = /^(?:[0-9]{1,15})$/.test(String(raw.dispatchAtMs))
    ? Number(raw.dispatchAtMs)
    : 0
  if (indexedDue > now) return { status: 'stale' }
  const prior = raw.dispatchIntegrity
  if (Object.hasOwn(raw, 'dispatchIntegrity') && !validIntegrityReview(prior))
    return { status: 'unresolved', reason: 'unprovable-financial-record' }
  if (validIntegrityReview(prior) && prior.nextReviewAtMs > now) return { status: 'stale' }
  if (
    Array.isArray(raw.markers) &&
    raw.markers.some(
      (head: unknown) =>
        object(head) &&
        head.state === 'claimed' &&
        typeof head.claimId === 'string' &&
        indexTime(head.claimExpiresAtMs) &&
        head.claimExpiresAtMs > now
    )
  )
    return { status: 'busy' }
  const shapeCode = dispatchShape(raw, now)
  const code =
    !memberBasisComplete && (!shapeCode || shapeCode === 'invalid-schedule')
      ? 'incomplete-member-basis'
      : shapeCode
  const detached = structuredClone(raw) as unknown as FinancialReceipt & Dispatch
  Reflect.deleteProperty(detached, 'dispatchIntegrity')
  const coherentProjection = !code && projectDispatch(detached)
  const financialDone =
    coherentProjection &&
    detached.dispatchState === 'complete' &&
    (detached.recordType !== 'invoice' || detached.invoiceObligationState === 'closed') &&
    (detached.recordType !== 'operation' || detached.holdState === 'closed') &&
    (detached.recordType !== 'period' || provedClosing(detached.closing, root))
  if (
    !validIntegrityReview(prior) &&
    coherentProjection &&
    raw.dispatchState === detached.dispatchState &&
    raw.dispatchAtMs === detached.dispatchAtMs &&
    raw.financialClosureState === detached.financialClosureState
  )
    return { status: 'stale' }
  if (
    validIntegrityReview(prior) &&
    memberBasisComplete &&
    ['invalid-schedule', 'projection-conflict'].includes(prior.code) &&
    prior.evidenceFingerprint === integrityEvidence(raw) &&
    coherentProjection &&
    (detached.dispatchState === 'pending' || financialDone)
  ) {
    if (financialDone) detached.financialClosureState = 'closed'
    if (detached.dispatchState === 'pending')
      detached.dispatchAtMs = Math.max(now, detached.dispatchAtMs)
    const updated = await tx
      .update(idempotencyKey)
      .set({ result: detached })
      .where(
        and(
          receiptWhere(candidate.namespace, candidate.key),
          sql`${idempotencyKey.result}::jsonb = ${JSON.stringify(raw)}::jsonb`
        )
      )
      .returning({ key: idempotencyKey.key })
    if (
      updated.length &&
      detached.recordType === 'period' &&
      detached.financialClosureState === 'closed'
    )
      await closeFinancialHeadIfProved(tx, candidate.namespace)
    return updated.length
      ? { status: 'recovered', nextAtMs: detached.dispatchAtMs }
      : { status: 'stale' }
  }
  const fault: DispatchIntegrityCode =
    validIntegrityReview(prior) && !['invalid-schedule', 'projection-conflict'].includes(prior.code)
      ? prior.code
      : (code ?? (validIntegrityReview(prior) ? prior.code : 'projection-conflict'))
  const reviews = validIntegrityReview(prior) ? prior.reviews + 1 : 1
  if (!safeTime(reviews)) return { status: 'unresolved', reason: 'unprovable-financial-record' }
  const previousFailures = Array.isArray(raw.markers)
    ? Math.max(
        0,
        ...raw.markers.map((head: unknown) =>
          object(head) && safeTime(head.failedAttempts) ? head.failedAttempts : 0
        )
      )
    : 0
  const nextReviewAtMs = dispatchBackoff(
    { id: candidate.key, attempts: Math.max(reviews, previousFailures) },
    now
  )
  if (!safeTime(nextReviewAtMs) || nextReviewAtMs > 999_999_999_999_999)
    return { status: 'unresolved', reason: 'conflicting-observation' }
  const dispatchIntegrity: DispatchIntegrityReview = {
    code: fault,
    observedFingerprint,
    evidenceFingerprint: validIntegrityReview(prior)
      ? prior.evidenceFingerprint
      : integrityEvidence(raw),
    reviews,
    firstObservedAtMs: validIntegrityReview(prior) ? prior.firstObservedAtMs : now,
    reviewedAtMs: now,
    nextReviewAtMs,
  }
  const result = {
    ...raw,
    dispatchIntegrity,
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: nextReviewAtMs,
  }
  const updated = await tx
    .update(idempotencyKey)
    .set({ result })
    .where(
      and(
        receiptWhere(candidate.namespace, candidate.key),
        sql`${idempotencyKey.result}::jsonb = ${JSON.stringify(raw)}::jsonb`
      )
    )
    .returning({ key: idempotencyKey.key })
  return updated.length
    ? { status: 'classified', code: fault, nextReviewAtMs }
    : { status: 'stale' }
}

export async function advanceFinancialDispatch(
  tx: FinancialTransaction,
  claim: DispatchClaim,
  update: (receipt: FinancialReceipt & Dispatch, marker: FinancialMarker) => void,
  now: number
) {
  await lockFinancialRoots(tx, [claim.root])
  await lockReceiptKeys(tx, claim.candidate.namespace, [claim.candidate.key])
  const receipt = await readFinancialReceipt(tx, claim.candidate.namespace, claim.candidate.key)
  if (!receipt || !('markers' in receipt)) fail('Financial dispatch receipt disappeared')
  const current = receipt.markers.find((marker) => marker.id === claim.marker.id)
  if (!current || current.claimId !== claim.marker.claimId || current.state !== 'claimed')
    return false
  update(receipt, current)
  if (current.state === 'claimed') current.state = 'pending'
  current.claimId = undefined
  current.claimExpiresAtMs = undefined
  if (current.state === 'pending') current.nextAtMs = Math.max(now, current.nextAtMs)
  projectDispatch(receipt)
  if (
    receipt.dispatchState === 'complete' &&
    (receipt.recordType !== 'period' || receipt.closing !== null) &&
    (receipt.recordType !== 'invoice' || receipt.invoiceObligationState === 'closed')
  )
    receipt.financialClosureState = 'closed'
  await writeFinancialReceipt(tx, claim.candidate.namespace, claim.candidate.key, receipt)
  if (receipt.recordType === 'period' && receipt.financialClosureState === 'closed')
    await closeFinancialHeadIfProved(tx, claim.candidate.namespace)
  return true
}
export function dispatchBackoff(marker: Pick<FinancialMarker, 'attempts' | 'id'>, now: number) {
  if (marker.attempts >= 8) return now + 900_000
  const jitter = Number.parseInt(financialFingerprint(marker.id).slice(0, 4), 16) % 10_000
  return now + Math.min(3_600_000, 60_000 * 2 ** Math.max(0, marker.attempts - 1)) + jitter
}

/** Persist provider identity before contact, retaining the current claim's CAS. */
export async function prepareFinancialContact(
  tx: FinancialTransaction,
  claim: DispatchClaim,
  input: {
    provider: FinancialMarker['provider']
    requestKey: string
    fingerprint: string
    now: number
    payload?: Record<string, unknown>
  }
) {
  await lockFinancialRoots(tx, [claim.root])
  await lockReceiptKeys(tx, claim.candidate.namespace, [claim.candidate.key])
  const receipt = await readFinancialReceipt(tx, claim.candidate.namespace, claim.candidate.key)
  if (!receipt || !('markers' in receipt)) fail('Financial contact target missing')
  const current = receipt.markers.find((marker) => marker.id === claim.marker.id)
  if (!current || current.claimId !== claim.marker.claimId || current.state !== 'claimed')
    fail('Financial contact claim was lost')
  invoiceContactPrepared(receipt, current, input.now)
  if (
    current.requestKey &&
    (current.requestKey !== input.requestKey ||
      current.requestFingerprint !== input.fingerprint ||
      current.provider !== input.provider)
  )
    fail('Financial provider request fingerprint changed')
  const prepared = {
    ...current,
    requestKey: input.requestKey,
    requestFingerprint: input.fingerprint,
    provider: input.provider,
    firstContactAtMs: current.firstContactAtMs ?? input.now,
  }
  if (input.payload) {
    if (Buffer.byteLength(JSON.stringify(input.payload), 'utf8') > 512 * 1024)
      fail('Financial delivery evidence exceeds bounded size')
    prepared.payload = { ...current.payload, ...input.payload }
  }
  invoiceContactPrepared(receipt, prepared, input.now)
  Object.assign(current, prepared)
  await writeFinancialReceipt(tx, claim.candidate.namespace, claim.candidate.key, receipt)
  Object.assign(claim.marker, current)
}
export async function acknowledgeInvoiceIssued(
  tx: FinancialTransaction,
  namespace: string,
  key: string,
  invoiceId: string
) {
  const initial = await readFinancialReceipt(tx, namespace, key)
  if (!initial || initial.recordType !== 'invoice') fail('Invoice financial intent missing')
  await lockFinancialRoots(tx, [initial.root])
  await lockReceiptKeys(tx, namespace, [key, 'period-head', periodKey(initial.period)])
  const intent = await readFinancialReceipt(tx, namespace, key)
  const basis = await readFinancialReceipt(tx, namespace, periodKey(initial.period))
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (!intent || intent.recordType !== 'invoice' || !basis || basis.recordType !== 'period')
    fail('Invoice period binding missing')
  if (intent.invoiceId && intent.invoiceId !== invoiceId) fail('Invoice provider identity changed')
  intent.invoiceId = invoiceId
  if (intent.issuance === 'pending') {
    const usd = centsToUsd(intent.amountCents)
    if (compareMoney(basis.commitments.pendingUsd, usd) < 0)
      fail('Invoice pending reservation is inconsistent')
    basis.commitments.pendingUsd = subtractMoney(basis.commitments.pendingUsd, usd)
    basis.commitments.issuedUsd = addMoney(basis.commitments.issuedUsd, usd)
    intent.issuance = 'issued'
    if (head?.recordType === 'period-head' && samePeriod(head.current, intent.period)) {
      const target =
        intent.root.type === 'user'
          ? { table: userStats, where: eq(userStats.userId, intent.root.id) }
          : {
              table: organizationBillingLedger,
              where: eq(organizationBillingLedger.organizationId, intent.root.id),
            }
      await tx
        .update(target.table)
        .set({ billedOverageThisPeriod: sql`${target.table.billedOverageThisPeriod} + ${usd}` })
        .where(target.where)
    }
  }
  await writeFinancialReceipt(tx, namespace, key, intent)
  await writeFinancialReceipt(tx, namespace, periodKey(intent.period), basis)
}
export async function readSubscriptionInvoice(tx: FinancialTransaction, invoiceId: string) {
  const key = `subscription-invoice:${financialFingerprint(required(invoiceId))}`
  const rows = await tx
    .select({ namespace: idempotencyKey.namespace })
    .from(idempotencyKey)
    .where(
      and(eq(idempotencyKey.key, key), sql`${idempotencyKey.namespace} LIKE 'billing-usage:%'`)
    )
    .limit(2)
  if (!rows.length) return null
  if (rows.length !== 1) fail('Subscription invoice original owner is ambiguous')
  const intent = await readFinancialReceipt(tx, rows[0].namespace, key)
  if (
    !intent ||
    intent.recordType !== 'invoice' ||
    intent.subtype !== 'subscription' ||
    intent.invoiceId !== invoiceId
  )
    fail('Original subscription invoice evidence is invalid')
  return { namespace: rows[0].namespace, key, intent }
}
/** Accept a signature-verified base invoice as debt, without reserving or posting usage. */
export async function registerSubscriptionInvoice(
  tx: FinancialTransaction,
  input: {
    root: FinancialRoot
    period: Period
    invoiceId: string
    amountCents: DecimalAmount
    currency: string
  }
) {
  const { root, period } = input
  const namespace = financialNamespace(root)
  const key = `subscription-invoice:${financialFingerprint(required(input.invoiceId))}`
  if (
    input.currency !== 'usd' ||
    shiftMoney(centsToUsd(input.amountCents), 2) !== input.amountCents
  )
    fail('Signed subscription invoice currency or amount is invalid')
  const fingerprint = financialFingerprint({
    root,
    period,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    currency: 'usd',
    subtype: 'subscription',
  })
  const prior = await readFinancialReceipt(tx, namespace, key)
  if (prior) {
    if (prior.recordType !== 'invoice' || prior.fingerprint !== fingerprint)
      fail('Signed subscription invoice original binding changed')
    return { namespace, key, intent: prior }
  }
  await lockFinancialRoots(tx, [root])
  const [original] = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.id, period.subscriptionId),
        eq(subscription.referenceType, root.type),
        eq(subscription.referenceId, root.id)
      )
    )
    .limit(1)
  if (
    !original ||
    !period.stripeSubscriptionId ||
    !period.customerId ||
    original.stripeSubscriptionId !== period.stripeSubscriptionId ||
    original.stripeCustomerId !== period.customerId ||
    !period.start ||
    !period.end ||
    !(Date.parse(period.start) < Date.parse(period.end))
  )
    fail('Signed subscription invoice has no provable original customer/subscription/period')
  const originalPeriod: Period = {
    subscriptionId: original.id,
    stripeSubscriptionId: original.stripeSubscriptionId,
    customerId: original.stripeCustomerId,
    start: original.periodStart?.toISOString() ?? null,
    end: original.periodEnd?.toISOString() ?? null,
  }
  const basis = await readFinancialReceipt(tx, namespace, periodKey(period))
  if (!basis) {
    if (!samePeriod(originalPeriod, period))
      fail('Historical invoice has no preserved original financial period')
    const policy = await currentPolicy(tx, root)
    if (!samePeriod(policy.period, period))
      fail('Invoice does not match the exact active financial period')
    await ensureOpenBasis(tx, { root, memberUserId: null }, policy)
  } else if (basis.recordType !== 'period' || !samePeriod(basis.period, period))
    fail('Signed invoice financial period is invalid')
  await lockReceiptKeys(tx, namespace, [key])
  const raced = await readFinancialReceipt(tx, namespace, key)
  if (raced) {
    if (raced.recordType !== 'invoice' || raced.fingerprint !== fingerprint)
      fail('Signed invoice binding changed')
    return { namespace, key, intent: raced }
  }
  const intent: InvoiceReceipt = {
    recordType: 'invoice',
    root,
    period,
    fingerprint,
    amountCents: input.amountCents,
    currency: 'usd',
    invoiceObligationState: 'open',
    issuance: 'issued',
    invoiceId: input.invoiceId,
    requestKey: `stripe-invoice:${input.invoiceId}`,
    subtype: 'subscription',
    financialClosureState: 'open',
    ...emptyDispatch(),
  }
  await writeFinancialReceipt(tx, namespace, key, intent)
  return { namespace, key, intent }
}
export async function acceptInvoicePayment(
  tx: FinancialTransaction,
  input: {
    namespace: string
    key: string
    invoiceId: string
    customerId: string
    amountCents: DecimalAmount
    currency: string
    paid: boolean
    fingerprint: string
    period: Period
    notifyFailure?: boolean
  }
) {
  if (shiftMoney(centsToUsd(input.amountCents), 2) !== input.amountCents)
    fail('Canonical integer cents required')
  const initial = await readFinancialReceipt(tx, input.namespace, input.key)
  if (!initial || initial.recordType !== 'invoice')
    fail('Signed invoice has no original financial intent')
  if (
    financialNamespace(initial.root) !== input.namespace ||
    initial.fingerprint !== input.fingerprint ||
    !samePeriod(initial.period, input.period)
  )
    fail('Signed invoice original financial reference mismatch')
  // Already closed duplicate readback is harmless after allowed entity deletion.
  if (
    initial.invoiceObligationState === 'closed' &&
    initial.invoiceId === input.invoiceId &&
    initial.period.customerId === input.customerId &&
    initial.amountCents === input.amountCents &&
    input.currency === 'usd'
  )
    return
  await lockFinancialRoots(tx, [initial.root])
  await lockReceiptKeys(tx, input.namespace, [input.key, 'period-head', periodKey(input.period)])
  const intent = await readFinancialReceipt(tx, input.namespace, input.key)
  if (
    !intent ||
    intent.recordType !== 'invoice' ||
    financialNamespace(intent.root) !== input.namespace ||
    financialFingerprint(intent.root) !== financialFingerprint(initial.root) ||
    intent.fingerprint !== input.fingerprint ||
    !samePeriod(intent.period, input.period) ||
    intent.period.customerId !== input.customerId ||
    intent.amountCents !== input.amountCents ||
    input.currency !== 'usd' ||
    (intent.invoiceId && intent.invoiceId !== input.invoiceId)
  )
    fail('Signed invoice original financial binding mismatch')
  // The initial read may precede another settlement while this transaction waits for the root.
  if (intent.invoiceObligationState === 'closed') return
  if (input.paid && intent.subtype !== 'subscription')
    await acknowledgeInvoiceIssued(tx, input.namespace, input.key, input.invoiceId)
  intent.invoiceId = input.invoiceId
  if (input.paid) intent.issuance = 'issued'
  if (
    !input.paid &&
    input.notifyFailure !== false &&
    !intent.markers.some((marker) => marker.id === `payment-failed:${input.invoiceId}`)
  ) {
    intent.markers.push(
      marker(
        'notification',
        'invoice-failure-fanout',
        Date.now(),
        `payment-failed:${input.invoiceId}`
      )
    )
    projectDispatch(intent)
  }
  if (input.paid) {
    intent.invoiceObligationState = 'closed'
    for (const marker of intent.markers) if (marker.kind === 'invoice') marker.state = 'complete'
    projectDispatch(intent)
    intent.financialClosureState = intent.dispatchState === 'complete' ? 'closed' : 'open'
  }
  await writeFinancialReceipt(tx, input.namespace, input.key, intent)
  const target =
    intent.root.type === 'user'
      ? { table: userStats, where: eq(userStats.userId, intent.root.id) }
      : {
          table: organizationBillingLedger,
          where: eq(organizationBillingLedger.organizationId, intent.root.id),
        }
  const [otherDebt] = await tx
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(
      and(
        eq(idempotencyKey.namespace, input.namespace),
        closurePredicate,
        sql`${idempotencyKey.result}->>'invoiceObligationState' = 'open'`
      )
    )
    .limit(1)
  await tx
    .update(target.table)
    .set({ billingBlocked: !input.paid || Boolean(otherDebt) })
    .where(target.where)
}

export type FinancialDatabase = FinancialTransaction & {
  transaction<T>(callback: (tx: FinancialTransaction) => Promise<T>): Promise<T>
}
export type FinancialDispatchOutcome = { outcome: 'complete' | 'progress' | 'uncertain' | 'retry' }
export type FinancialDispatchDrainOptions = {
  now?: () => number
  execute: (
    claim: DispatchClaim,
    deadlineAt: number
  ) => Promise<undefined | FinancialDispatchOutcome>
}
/** Bounded scheduled service, independent of request traffic and provider-specific credentials. */
export async function drainFinancialDispatch(
  store: FinancialDatabase,
  options: FinancialDispatchDrainOptions
) {
  const now = options.now ?? Date.now
  const started = now()
  const visited = new Set<string>()
  let cursor: DispatchCandidate | undefined
  let completed = 0
  let uncertain = 0
  let retryable = 0
  let skipped = 0
  let classified = 0
  let integrityUnresolved = 0
  let failed = false
  const slot = async () => {
    while (!failed && now() - started < 20_000 && started + 45_000 - now() >= 25_000) {
      const candidates = await listFinancialDispatch(store, now(), cursor, 100)
      if (failed) return
      if (!candidates.length) return
      const candidate = candidates.find(
        (candidate) => !visited.has(`${candidate.namespace}\n${candidate.key}`)
      )
      if (!candidate) {
        cursor = candidates.at(-1)
        continue
      }
      visited.add(`${candidate.namespace}\n${candidate.key}`)
      let claim: DispatchClaim | null
      if (failed) return
      try {
        claim = await store.transaction((tx) => claimFinancialDispatch(tx, candidate, now()))
      } catch (error) {
        if (error instanceof FinancialPolicyError && error.code === 'root-busy') {
          skipped++
          continue
        }
        if (error instanceof FinancialDispatchIntegrityError) {
          const review = await store.transaction((tx) =>
            classifyFinancialDispatch(tx, candidate, error.observedFingerprint, now())
          )
          if (review.status === 'classified' || review.status === 'recovered') classified++
          else if (review.status === 'unresolved') integrityUnresolved++
          else skipped++
          continue
        }
        failed = true
        return
      }
      if (!claim) {
        skipped++
        continue
      }
      if (failed || now() - started >= 20_000) {
        await store.transaction((tx) =>
          advanceFinancialDispatch(
            tx,
            claim!,
            (_receipt, marker) => {
              marker.state = claim!.reconcile ? 'uncertain' : 'pending'
              marker.nextAtMs = now()
            },
            now()
          )
        )
        return
      }
      try {
        const outcome = await options.execute(claim, now() + 20_000)
        if (outcome?.outcome === 'uncertain') uncertain++
        else if (outcome?.outcome === 'retry') retryable++
        else completed++
      } catch (error) {
        if (claim.marker.firstContactAtMs !== undefined) uncertain++
        else retryable++
        await store.transaction((tx) =>
          advanceFinancialDispatch(
            tx,
            claim!,
            (_receipt, marker) => {
              marker.state = marker.firstContactAtMs !== undefined ? 'uncertain' : 'pending'
              marker.failedAttempts += 1
              marker.failure =
                error instanceof FinancialPolicyError
                  ? error.message.slice(0, 300)
                  : 'Financial provider outcome requires classification'
              marker.nextAtMs = dispatchBackoff(
                { id: marker.id, attempts: marker.failedAttempts },
                now()
              )
            },
            now()
          )
        )
      }
    }
  }
  await Promise.all(
    [0, 1, 2, 3].map(async () => {
      try {
        await slot()
      } catch {
        failed = true
      }
    })
  )
  if (failed)
    throw new FinancialPolicyError('Financial dispatch storage service is unavailable', 503)
  return {
    completed,
    uncertain,
    retryable,
    skipped,
    classified,
    integrityUnresolved,
    visited: visited.size,
  }
}

async function closeFinancialHeadIfProved(tx: FinancialTransaction, namespace: string) {
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (!head || head.recordType !== 'period-head')
    fail('Original financial period head missing during closure')
  for (const period of [head.current, head.previous].filter(
    (period): period is Period => period !== null
  )) {
    const basis = await readFinancialReceipt(tx, namespace, periodKey(period))
    if (
      !basis ||
      basis.recordType !== 'period' ||
      !basis.closing ||
      basis.financialClosureState !== 'closed'
    )
      return
  }
  head.financialClosureState = 'closed'
  await writeFinancialReceipt(tx, namespace, 'period-head', head)
}

export async function createFinancialNotification(
  tx: FinancialTransaction,
  input: {
    namespace: string
    sourceKey: string
    recipientUserId: string
    notificationKind: string
    now?: number
  }
) {
  const source = await readFinancialReceipt(tx, input.namespace, input.sourceKey)
  if (!source || (source.recordType !== 'operation' && source.recordType !== 'invoice'))
    fail('Financial notification source is not an accepted money event')
  const root = source.recordType === 'operation' ? source.identity.root : source.root
  if (
    financialNamespace(root) !== input.namespace ||
    (source.recordType === 'operation' && source.contactState !== 'accepted')
  )
    fail('Financial notification original source mismatch')
  await lockFinancialRoots(tx, [root])
  const fingerprint = financialFingerprint({
    source: input.sourceKey,
    recipient: required(input.recipientUserId),
    kind: required(input.notificationKind),
  })
  const key = `notification:${fingerprint}`
  await lockReceiptKeys(tx, input.namespace, [input.sourceKey, key])
  const prior = await readFinancialReceipt(tx, input.namespace, key)
  if (prior) {
    if (prior.recordType !== 'notification' || prior.fingerprint !== fingerprint)
      fail('Financial notification identity was reused')
    return { namespace: input.namespace, key }
  }
  const now = input.now ?? Date.now()
  const row: NotificationReceipt = {
    recordType: 'notification',
    root,
    period: source.recordType === 'operation' ? source.identity.period : source.period,
    sourceKey: input.sourceKey,
    recipientUserId: input.recipientUserId,
    notificationKind: input.notificationKind,
    fingerprint,
    financialClosureState: 'open',
    dispatchState: 'pending',
    dispatchAtMs: now,
    markers: [marker('notification', 'prepare', now, `delivery:${fingerprint}`)],
  }
  await writeFinancialReceipt(tx, input.namespace, key, row)
  return { namespace: input.namespace, key }
}

export async function financialUsageNotificationFacts(
  tx: FinancialTransaction,
  namespace: string,
  operationKey: string
) {
  const initial = await readFinancialReceipt(tx, namespace, operationKey)
  if (!initial || initial.recordType !== 'operation' || initial.contactState !== 'accepted')
    fail('Usage notification has no accepted original operation')
  const identity = initial.identity
  await lockFinancialRoots(tx, [identity.root])
  const head = await readFinancialReceipt(tx, namespace, 'period-head')
  if (
    !identity.period ||
    !head ||
    head.recordType !== 'period-head' ||
    !samePeriod(head.current, identity.period)
  )
    return null
  const basis = await readFinancialReceipt(tx, namespace, periodKey(identity.period))
  if (
    !basis ||
    basis.recordType !== 'period' ||
    !samePeriod(basis.period, identity.period) ||
    financialNamespace(basis.root) !== namespace
  )
    fail('Usage notification original financial basis is missing or conflicting')
  if (basis.closing || basis.suspension) return null
  const policy = await currentPolicy(tx, identity.root)
  if (!samePeriod(policy.period, identity.period)) return null
  if (identity.memberUserId) {
    const [membership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.organizationId, identity.root.id), eq(member.userId, identity.memberUserId))
      )
      .limit(1)
    if (!membership) return null
  }
  const notice = initial.markers.find(
    (marker) => marker.phase === 'usage-evaluate' || marker.id === `usage-notice:${operationKey}`
  )
  if (!notice?.payload) return null
  const beforeUsd = monetary(notice.payload.beforeUsd)
  const afterUsd = monetary(notice.payload.afterUsd)
  const allowance = monetary(policy.tier.includedUsageLimitUsd ?? '0')
  let limitUsd = allowance
  if (identity.root.type === 'organization' && !identity.memberUserId) {
    const [org] = await tx
      .select({ limit: organization.orgUsageLimit })
      .from(organization)
      .where(eq(organization.id, identity.root.id))
      .limit(1)
    limitUsd = maxMoney(
      multiplyMoney(allowance, seatQuantity(policy.sub.seats)),
      org?.limit === null ? '0' : monetary(org?.limit ?? fail('Original organization cap missing'))
    )
  } else if (identity.root.type === 'user') {
    const [ledger] = await tx
      .select({ limit: userStats.customUsageLimit })
      .from(userStats)
      .where(eq(userStats.userId, identity.root.id))
      .limit(1)
    if (!ledger) fail('Original financial ledger missing')
    limitUsd = maxMoney(allowance, ledger.limit === null ? '0' : monetary(ledger.limit))
  }
  if (limitUsd === '0') return null
  const [settings] = await tx
    .select()
    .from(systemBillingSettings)
    .where(eq(systemBillingSettings.id, 'global'))
    .limit(1)
  const warningAt = decimalFromSafeInteger(settings?.usageWarningThresholdPercent ?? 80)
  const upgradeAt = decimalFromSafeInteger(settings?.freeTierUpgradeThresholdPercent ?? 90)
  const crosses = (threshold: DecimalAmount) =>
    compareMoney(multiplyMoney(beforeUsd, '100'), multiplyMoney(limitUsd, threshold)) < 0 &&
    compareMoney(multiplyMoney(afterUsd, '100'), multiplyMoney(limitUsd, threshold)) >= 0
  // Presentation only. No financial decision uses this bounded displayed ratio.
  const afterPercent = displayPercentage(afterUsd, limitUsd)
  return {
    root: identity.root,
    memberUserId: identity.memberUserId,
    period: identity.period,
    planName: policy.tier.displayName,
    isFreeTier: policy.tier.isDefault || !policy.sub.stripeSubscriptionId,
    limitUsd,
    afterUsd,
    afterPercent,
    warning: crosses(warningAt),
    upgrade: identity.root.type === 'user' && policy.tier.isDefault && crosses(upgradeAt),
  }
}
