import {
  closeFinancialPeriod,
  FinancialPolicyError,
  type FinancialRoot,
  type FinancialTransaction,
  financialNamespace,
  lockFinancialRoots,
  type Period,
  periodKey,
  readFinancialReceipt,
  resumeFinancialPeriodEligibility,
  rotateFinancialPeriod,
  suspendFinancialPeriodEligibility,
} from '@tradinggoose/billing'
import { monetary } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import {
  invitation,
  member,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  subscription,
  systemBillingTier,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'

type SubscriptionRow = typeof subscription.$inferSelect
type SubscriptionPatch = Partial<Omit<typeof subscription.$inferInsert, 'id'>>
const periodOf = (row: SubscriptionRow): Period => ({
  subscriptionId: row.id,
  stripeSubscriptionId: row.stripeSubscriptionId,
  customerId: row.stripeCustomerId,
  start: row.periodStart?.toISOString() ?? null,
  end: row.periodEnd?.toISOString() ?? null,
})
const samePeriod = (a: Period, b: Period) => JSON.stringify(a) === JSON.stringify(b)
const entitled = (row: SubscriptionRow) =>
  ['active', 'trialing', 'past_due'].includes(row.status ?? '')

export function validateFinancialPeriod(
  candidate: SubscriptionRow,
  tier: typeof systemBillingTier.$inferSelect
) {
  if (!entitled(candidate)) return
  const start = candidate.periodStart
  const end = candidate.periodEnd
  if (
    (start == null) !== (end == null) ||
    (start != null && (!(start instanceof Date) || !Number.isFinite(start.getTime()))) ||
    (end != null && (!(end instanceof Date) || !Number.isFinite(end.getTime()))) ||
    (start != null && end != null && start >= end) ||
    (!tier.isDefault && (start == null || end == null))
  )
    throw new FinancialPolicyError('Exact financial period is invalid')
}

/** Studio owns Stripe customer binding; preserve an established original customer. */
export async function validateFinancialCustomer(
  tx: FinancialTransaction,
  root: FinancialRoot,
  candidate: Pick<SubscriptionRow, 'stripeCustomerId' | 'stripeSubscriptionId'>,
  before?: Pick<SubscriptionRow, 'stripeCustomerId' | 'stripeSubscriptionId'>
) {
  const customer = candidate.stripeCustomerId
  if (
    before?.stripeSubscriptionId &&
    candidate.stripeSubscriptionId !== before.stripeSubscriptionId
  )
    throw new FinancialPolicyError('Original Stripe subscription identity cannot be overwritten')
  if (customer !== null && (typeof customer !== 'string' || !customer.trim()))
    throw new FinancialPolicyError('Financial customer identity is invalid')
  if (before?.stripeCustomerId && customer !== before.stripeCustomerId)
    throw new FinancialPolicyError(
      'Original financial customer cannot change without reconciliation'
    )
  if (candidate.stripeSubscriptionId && !customer)
    throw new FinancialPolicyError('Stripe subscription has no verified customer')
  if (root.type === 'user' && customer && !before?.stripeCustomerId) {
    const [owner] = await tx
      .select({ customer: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, root.id))
      .limit(1)
    if (!owner?.customer || customer !== owner.customer)
      throw new FinancialPolicyError(
        'First subscription customer does not match its verified original user'
      )
  }
}

/** Called before a financial identity is overwritten, inside its original root transaction. */
export async function freezeSubscriptionBeforeMutation(
  tx: FinancialTransaction,
  before: SubscriptionRow,
  candidate: SubscriptionRow
) {
  const root: FinancialRoot = { type: before.referenceType, id: before.referenceId }
  if (candidate.referenceType !== root.type || candidate.referenceId !== root.id)
    throw new FinancialPolicyError('Subscription cannot transfer original financial ownership')
  if (root.type === 'organization' && samePeriod(periodOf(before), periodOf(candidate))) {
    if (
      !before.billingTierId ||
      !candidate.billingTierId ||
      before.plan !== before.billingTierId ||
      candidate.plan !== candidate.billingTierId
    )
      throw new FinancialPolicyError('Complete original and requested monetary tiers are required')
    const tiers = await tx
      .select()
      .from(systemBillingTier)
      .where(inArray(systemBillingTier.id, [before.billingTierId, candidate.billingTierId]))
    const originalTier = tiers.find((tier) => tier.id === before.billingTierId)
    const requestedTier = tiers.find((tier) => tier.id === candidate.billingTierId)
    if (
      !originalTier ||
      !requestedTier ||
      [originalTier, requestedTier].some(
        (tier) =>
          tier.ownerType !== 'organization' || !['pooled', 'individual'].includes(tier.usageScope)
      )
    )
      throw new FinancialPolicyError(
        'Original and requested organization monetary scopes are invalid'
      )
    if (originalTier.usageScope !== requestedTier.usageScope)
      throw new FinancialPolicyError('Same-period organization monetary scope cannot change')
  }
  const periodChanged = !samePeriod(periodOf(before), periodOf(candidate))
  if (
    !periodChanged &&
    entitled(before) &&
    !entitled(candidate) &&
    candidate.status !== 'canceled'
  ) {
    await suspendFinancialPeriodEligibility(tx, root, periodOf(before))
    return false
  }
  const changed =
    periodChanged || candidate.status === 'canceled' || (!entitled(before) && entitled(candidate))
  if (!changed) return false
  const head = await readFinancialReceipt(tx, financialNamespace(root), 'period-head')
  if (head && before.status === 'canceled' && entitled(candidate))
    throw new FinancialPolicyError(
      'Canceled financial identity cannot be reopened after financial history'
    )
  if (!head || (head.recordType === 'period-head' && head.current === null)) {
    const target =
      root.type === 'user'
        ? { table: userStats, where: eq(userStats.userId, root.id) }
        : {
            table: organizationBillingLedger,
            where: eq(organizationBillingLedger.organizationId, root.id),
          }
    const [ledger] = await tx
      .select({
        cost: target.table.totalCost,
        current: target.table.currentPeriodCost,
        prior: target.table.lastPeriodCost,
      })
      .from(target.table)
      .where(target.where)
    if (
      ledger &&
      [ledger.cost, ledger.current, ledger.prior].some((value) => monetary(value) !== '0')
    )
      throw new FinancialPolicyError(
        'Original financial period needs verified preservation before mutation'
      )
    return false
  }
  if (head.recordType !== 'period-head')
    throw new FinancialPolicyError('Financial period head is invalid')
  const priorBasis = await readFinancialReceipt(
    tx,
    financialNamespace(root),
    periodKey(head.current as Period)
  )
  if (!samePeriod(head.current as Period, periodOf(before))) {
    if ((head.current as Period).subscriptionId === before.id) {
      if (!priorBasis || priorBasis.recordType !== 'period' || !priorBasis.closing)
        throw new FinancialPolicyError('Original financial period changed without closing basis')
      if (entitled(candidate))
        throw new FinancialPolicyError('Closed subscription identity cannot be reopened')
    }
    return false
  }
  if (!periodChanged && !entitled(before) && entitled(candidate)) {
    if (priorBasis?.recordType !== 'period' || priorBasis.closing || !priorBasis.suspension)
      throw new FinancialPolicyError('Original suspended subscription authority is required')
    return false
  }
  if (!priorBasis || priorBasis.recordType !== 'period' || !priorBasis.closing)
    await closeFinancialPeriod(tx, root, periodOf(before))
  return entitled(candidate) && !samePeriod(periodOf(before), periodOf(candidate))
}

/** The local period change and its monetary slot rotation commit together exactly once. */
export async function rotateSubscriptionAfterMutation(
  tx: FinancialTransaction,
  before: SubscriptionRow,
  after: SubscriptionRow,
  shouldRotate: boolean,
  originalPeriod: Period = periodOf(before)
) {
  const root: FinancialRoot = { type: before.referenceType, id: before.referenceId }
  if (!shouldRotate) {
    if (!entitled(before) && entitled(after) && samePeriod(periodOf(before), periodOf(after))) {
      const basis = await readFinancialReceipt(
        tx,
        financialNamespace(root),
        periodKey(periodOf(after))
      )
      // The before-write guard already proved a missing basis to be genuinely fresh zero history.
      if (basis) await resumeFinancialPeriodEligibility(tx, root, periodOf(after))
    }
    return
  }
  if (
    originalPeriod.subscriptionId !== before.id ||
    originalPeriod.stripeSubscriptionId !== before.stripeSubscriptionId ||
    originalPeriod.customerId !== before.stripeCustomerId
  )
    throw new FinancialPolicyError('Original financial rollover binding is invalid')
  const targets =
    root.type === 'user'
      ? [{ table: userStats, where: eq(userStats.userId, root.id) }]
      : [
          {
            table: organizationBillingLedger,
            where: eq(organizationBillingLedger.organizationId, root.id),
          },
          {
            table: organizationMemberBillingLedger,
            where: eq(organizationMemberBillingLedger.organizationId, root.id),
          },
        ]
  const head = await readFinancialReceipt(tx, financialNamespace(root), 'period-head')
  if (!head || head.recordType !== 'period-head' || !head.current)
    throw new FinancialPolicyError('Financial period head is missing')
  if (samePeriod(head.current, periodOf(after))) return
  if (!samePeriod(head.current, originalPeriod))
    throw new FinancialPolicyError('Financial rollover identity changed')
  for (const target of targets) {
    await tx
      .update(target.table)
      .set({
        lastPeriodCost: sql`${target.table.currentPeriodCost}`,
        lastPeriodCopilotCost: sql`${target.table.currentPeriodCopilotCost}`,
        currentPeriodCost: '0',
        currentPeriodCopilotCost: '0',
        ...('billedOverageThisPeriod' in target.table ? { billedOverageThisPeriod: '0' } : {}),
        ...('updatedAt' in target.table ? { updatedAt: new Date() } : {}),
      })
      .where(target.where)
  }
  await rotateFinancialPeriod(tx, root, periodOf(after))
}

/** Retire only a genuine local default when a distinct paid identity becomes effective. */
export async function prepareFinancialActivation(
  tx: FinancialTransaction,
  candidate: SubscriptionRow
) {
  if (!entitled(candidate)) return null
  const others = await tx
    .select({ row: subscription, tier: systemBillingTier })
    .from(subscription)
    .innerJoin(systemBillingTier, eq(subscription.billingTierId, systemBillingTier.id))
    .where(
      and(
        eq(subscription.referenceType, candidate.referenceType),
        eq(subscription.referenceId, candidate.referenceId),
        ne(subscription.id, candidate.id),
        inArray(subscription.status, ['active', 'trialing', 'past_due'])
      )
    )
  if (!others.length) {
    const root: FinancialRoot = { type: candidate.referenceType, id: candidate.referenceId }
    const head = await readFinancialReceipt(tx, financialNamespace(root), 'period-head')
    if (!head || (head.recordType === 'period-head' && !head.current)) return null
    if (head.recordType !== 'period-head')
      throw new FinancialPolicyError('Original financial head is invalid')
    if (head.current!.subscriptionId === candidate.id) return null
    const originalPeriod = head.current!
    const basis = await readFinancialReceipt(
      tx,
      financialNamespace(root),
      periodKey(originalPeriod)
    )
    const [before] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, originalPeriod.subscriptionId))
      .limit(1)
    if (
      !before ||
      before.referenceType !== root.type ||
      before.referenceId !== root.id ||
      entitled(before) ||
      before.stripeSubscriptionId !== originalPeriod.stripeSubscriptionId ||
      before.stripeCustomerId !== originalPeriod.customerId ||
      !basis ||
      basis.recordType !== 'period' ||
      !basis.closing
    )
      throw new FinancialPolicyError(
        'Next subscription requires its retained original closing basis'
      )
    return { before, rotate: true, originalPeriod }
  }
  if (others.length !== 1 || !others[0].tier.isDefault || others[0].row.stripeSubscriptionId)
    throw new FinancialPolicyError(
      'Another effective financial subscription needs original settlement'
    )
  const before = others[0].row
  const rotate = await freezeSubscriptionBeforeMutation(tx, before, candidate)
  await tx.update(subscription).set({ status: 'canceled' }).where(eq(subscription.id, before.id))
  return { before, rotate, originalPeriod: periodOf(before) }
}

export async function createFinancialSubscription(
  input: typeof subscription.$inferInsert,
  transaction?: FinancialTransaction
) {
  const run = async (tx: FinancialTransaction) => {
    if (input.referenceType !== 'user' && input.referenceType !== 'organization')
      throw new FinancialPolicyError('Explicit financial subscription owner type required')
    const root: FinancialRoot = { type: input.referenceType, id: input.referenceId }
    await lockFinancialRoots(tx, [root])
    if (input.stripeSubscriptionId) {
      const [existing] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.stripeSubscriptionId, input.stripeSubscriptionId))
        .limit(1)
      if (existing) {
        if (existing.referenceId !== root.id || existing.referenceType !== root.type)
          throw new FinancialPolicyError('Stripe subscription original owner cannot change')
        const { id: _, ...patch } = input
        return updateFinancialSubscription(existing.id, patch, {
          transaction: tx,
          expectedStripeSubscriptionId: input.stripeSubscriptionId,
        })
      }
    }
    const [tier] = await tx
      .select()
      .from(systemBillingTier)
      .where(eq(systemBillingTier.id, input.plan))
      .limit(1)
    if (!tier || tier.ownerType !== root.type || input.billingTierId !== tier.id)
      throw new FinancialPolicyError('New subscription complete tier binding is required')
    const candidate = input as SubscriptionRow
    validateFinancialPeriod(candidate, tier)
    await validateFinancialCustomer(tx, root, {
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    })
    await validateFinancialSeatCapacity(tx, candidate, tier)
    const transition = await prepareFinancialActivation(tx, candidate)
    const [after] = await tx.insert(subscription).values(input).returning()
    if (
      !after ||
      after.plan !== after.billingTierId ||
      after.referenceId !== root.id ||
      after.referenceType !== root.type
    )
      throw new FinancialPolicyError('New subscription financial readback failed')
    if (transition)
      await rotateSubscriptionAfterMutation(
        tx,
        transition.before,
        after,
        transition.rotate,
        transition.originalPeriod
      )
    return after
  }
  return transaction ? run(transaction) : db.transaction(run)
}

export async function updateFinancialSubscription(
  id: string,
  patch: SubscriptionPatch,
  options: {
    transaction?: FinancialTransaction
    actorUserId?: string
    expectedSeats?: number | null
    expectedStripeSubscriptionId?: string | null
  } = {}
): Promise<SubscriptionRow> {
  const run = async (tx: FinancialTransaction) => {
    const [initial] = await tx.select().from(subscription).where(eq(subscription.id, id)).limit(1)
    if (!initial) throw new FinancialPolicyError('Original subscription is missing')
    const root: FinancialRoot = { type: initial.referenceType, id: initial.referenceId }
    await lockFinancialRoots(tx, [root])
    const [before] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, id))
      .for('update')
      .limit(1)
    if (!before || before.referenceType !== root.type || before.referenceId !== root.id)
      throw new FinancialPolicyError('Subscription identity changed while waiting')
    if (
      options.expectedSeats !== undefined &&
      before.seats !== options.expectedSeats &&
      before.seats !== patch.seats
    )
      throw new FinancialPolicyError('Subscription seats changed; reconcile the remote result')
    if (options.actorUserId && root.type === 'organization') {
      const [owner] = await tx
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, root.id), eq(member.userId, options.actorUserId)))
        .limit(1)
      if (owner?.role !== 'owner')
        throw new FinancialPolicyError('Current organization owner authorization required', 403)
    }
    if (
      options.expectedStripeSubscriptionId !== undefined &&
      before.stripeSubscriptionId !== options.expectedStripeSubscriptionId
    )
      throw new FinancialPolicyError(
        'Original Stripe subscription changed; reconcile the remote result'
      )
    const candidate = { ...before, ...patch } as SubscriptionRow
    const [tier] = await tx
      .select()
      .from(systemBillingTier)
      .where(eq(systemBillingTier.id, candidate.plan))
      .limit(1)
    if (
      !tier ||
      tier.ownerType !== root.type ||
      (patch.billingTierId && patch.billingTierId !== tier.id)
    )
      throw new FinancialPolicyError('Subscription plan and canonical billing tier must agree')
    await validateFinancialCustomer(tx, root, candidate, before)
    candidate.billingTierId = tier.id
    validateFinancialPeriod(candidate, tier)
    await validateFinancialSeatCapacity(tx, candidate, tier)
    const activation = await prepareFinancialActivation(tx, candidate)
    const rotate = await freezeSubscriptionBeforeMutation(tx, before, candidate)
    const [after] = await tx
      .update(subscription)
      .set({ ...patch, billingTierId: tier.id, referenceType: root.type })
      .where(eq(subscription.id, id))
      .returning()
    if (
      !after ||
      after.plan !== after.billingTierId ||
      after.referenceId !== root.id ||
      after.referenceType !== root.type
    )
      throw new FinancialPolicyError('Complete financial subscription readback failed')
    if (activation)
      await rotateSubscriptionAfterMutation(
        tx,
        activation.before,
        after,
        activation.rotate,
        activation.originalPeriod
      )
    else await rotateSubscriptionAfterMutation(tx, before, after, rotate)
    return after
  }
  return options.transaction ? run(options.transaction) : db.transaction(run)
}

export async function validateFinancialSeatCapacity(
  tx: FinancialTransaction,
  candidate: SubscriptionRow,
  tier: typeof systemBillingTier.$inferSelect
) {
  if (candidate.referenceType !== 'organization') return
  const seats = candidate.seats ?? tier.seatCount ?? 1
  if (!Number.isSafeInteger(seats) || seats < 1)
    throw new FinancialPolicyError('Subscription seat quantity is invalid')
  const fixedSeats = tier.seatCount ?? 1
  if (
    tier.seatMode === 'fixed' &&
    (!Number.isSafeInteger(fixedSeats) ||
      fixedSeats < 1 ||
      (candidate.seats !== null && candidate.seats !== undefined && candidate.seats !== fixedSeats))
  )
    throw new FinancialPolicyError('Subscription seat quantity must equal the fixed tier quantity')
  if (
    tier.seatMode === 'adjustable' &&
    (seats < Math.max(tier.seatCount ?? 1, 1) ||
      (tier.seatMaximum !== null && seats > tier.seatMaximum))
  )
    throw new FinancialPolicyError('Subscription seat quantity is outside current tier bounds')
  const [members] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.organizationId, candidate.referenceId))
  const [pending] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invitation)
    .where(
      and(eq(invitation.organizationId, candidate.referenceId), eq(invitation.status, 'pending'))
    )
  if (Number(members.count) + Number(pending.count) > seats)
    throw new FinancialPolicyError(
      'Cannot reduce licensed capacity below members and pending invitations'
    )
}
