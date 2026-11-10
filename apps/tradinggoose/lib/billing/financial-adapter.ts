import {
  FinancialPolicyError,
  type FinancialRoot,
  type FinancialTransaction,
  initializeFinancialMemberRegistry,
  lockFinancialRoots,
  registerFinancialMember,
} from '@tradinggoose/billing'
import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { assertOrganizationFinancialCapacity } from '@/lib/billing/financial-membership'
import {
  freezeSubscriptionBeforeMutation,
  prepareFinancialActivation,
  rotateSubscriptionAfterMutation,
  validateFinancialCustomer,
  validateFinancialPeriod,
  validateFinancialSeatCapacity,
} from '@/lib/billing/financial-subscriptions'

type AdapterFactory = ReturnType<typeof drizzleAdapter>
type Adapter = ReturnType<AdapterFactory>
type Options = Parameters<AdapterFactory>[0]
type Mutation = 'create' | 'update' | 'updateMany' | 'delete' | 'deleteMany'
const effectiveModels = new Set(['subscription', 'member', 'invitation', 'organization'])
const methods: Mutation[] = ['create', 'update', 'updateMany', 'delete', 'deleteMany']
const conflict = (message: string): never => {
  throw new FinancialPolicyError(message)
}

async function candidateTier(tx: FinancialTransaction, candidate: Record<string, any>) {
  const [tier] = await tx
    .select()
    .from(schema.systemBillingTier)
    .where(
      and(
        eq(schema.systemBillingTier.id, candidate.plan),
        inArray(schema.systemBillingTier.status, ['active', 'archived'])
      )
    )
    .limit(1)
  if (!tier || !candidate.referenceId)
    conflict('Subscription mutation has no trusted plan/payer binding')
  return tier
}

async function protectSubscription(
  tx: FinancialTransaction,
  before: typeof schema.subscription.$inferSelect | undefined,
  candidate: Record<string, any>
) {
  const tier = await candidateTier(tx, candidate)
  const root: FinancialRoot = { type: tier.ownerType, id: candidate.referenceId }
  if (
    before &&
    (before.referenceId !== root.id || (before.billingTierId && before.referenceType !== root.type))
  )
    conflict('Subscription cannot transfer original financial ownership')
  const entity =
    root.type === 'user'
      ? await tx
          .select({ id: schema.user.id, customer: schema.user.stripeCustomerId })
          .from(schema.user)
          .where(eq(schema.user.id, root.id))
          .limit(1)
      : await tx
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(eq(schema.organization.id, root.id))
          .limit(1)
  if (!entity.length) conflict('Original subscription payer is missing')
  const customer =
    candidate.stripeCustomerId ??
    before?.stripeCustomerId ??
    ('customer' in entity[0] ? entity[0].customer : null)
  await validateFinancialCustomer(
    tx,
    root,
    {
      stripeCustomerId: customer ?? null,
      stripeSubscriptionId: candidate.stripeSubscriptionId ?? null,
    },
    before
  )
  if (before) {
    const [fresh] = await tx
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, before.id))
      .limit(1)
    if (
      !fresh ||
      fresh.plan !== before.plan ||
      fresh.periodStart?.getTime() !== before.periodStart?.getTime() ||
      fresh.periodEnd?.getTime() !== before.periodEnd?.getTime()
    )
      conflict('Subscription changed while waiting; reconcile the mutation')
  }
  const complete = before
    ? ({
        ...before,
        ...candidate,
        billingTierId: tier.id,
        referenceType: root.type,
        stripeCustomerId: customer ?? null,
      } as typeof schema.subscription.$inferSelect)
    : undefined
  const activating = {
    ...before,
    ...candidate,
    id: candidate.id ?? before?.id ?? '',
    billingTierId: tier.id,
    referenceType: root.type,
    stripeCustomerId: customer ?? null,
  } as typeof schema.subscription.$inferSelect
  validateFinancialPeriod(activating, tier)
  await validateFinancialSeatCapacity(tx, activating, tier)
  const activation = await prepareFinancialActivation(tx, activating)
  const rotate =
    before && complete ? await freezeSubscriptionBeforeMutation(tx, before, complete) : false
  return { tier, root, customer, before, rotate, activation }
}

function build(options: Options, tx?: FinancialTransaction): Adapter {
  const client = tx ?? db
  const base = drizzleAdapter(client, { provider: 'pg', schema, transaction: false })(options)
  const wrapped = { ...base }
  for (const method of methods) {
    const mutate = async (input: any) => {
      if (!effectiveModels.has(input.model))
        return (base[method] as (input: any) => Promise<any>)(input)
      const run = async (bound: FinancialTransaction) => {
        await bound.execute(sql`SELECT pg_advisory_xact_lock_shared(4126093::bigint)`)
        const delegate = drizzleAdapter(bound, { provider: 'pg', schema, transaction: false })(
          options
        )
        if (input.model === 'organization' && method === 'create') {
          const organizationId = crypto.randomUUID()
          const result = await initializeFinancialMemberRegistry(bound, organizationId, () =>
            delegate.create<Record<string, any>>({
              ...input,
              data: { ...input.data, id: organizationId },
              forceAllowId: true,
            })
          )
          if (result?.id !== organizationId)
            conflict('Actual organization insertion returned a conflicting stable ID')
          return result
        }
        if (input.model === 'member' && method === 'create') {
          const result = await registerFinancialMember(
            bound,
            { organizationId: input.data.organizationId, userId: input.data.userId },
            () => delegate.create<Record<string, any>>({ ...input })
          )
          await assertOrganizationFinancialCapacity(bound, input.data.organizationId)
          return result
        }
        let prior =
          method === 'create'
            ? []
            : await delegate.findMany<Record<string, any>>({
                model: input.model,
                where: input.where,
                limit: Number.MAX_SAFE_INTEGER,
              })
        let scopedInput =
          method === 'create'
            ? input
            : {
                ...input,
                where: [
                  ...(input.where ?? []),
                  { field: 'id', operator: 'in', value: prior.map((row) => row.id) },
                ],
              }
        let candidates =
          method === 'create' ? [input.data] : prior.map((row) => ({ ...row, ...input.update }))
        const refresh = async () => {
          if (method === 'create') return
          prior = await delegate.findMany<Record<string, any>>({
            model: input.model,
            where: scopedInput.where,
            limit: Number.MAX_SAFE_INTEGER,
          })
          candidates = prior.map((row) => ({ ...row, ...input.update }))
          scopedInput = {
            ...input,
            where: [
              ...(input.where ?? []),
              { field: 'id', operator: 'in', value: prior.map((row) => row.id) },
            ],
          }
        }
        if (input.model === 'organization' && (method === 'delete' || method === 'deleteMany'))
          conflict('Organization deletion requires the app-owned financial transaction')
        if (input.model === 'subscription') {
          if (method === 'delete' || method === 'deleteMany')
            conflict(
              'Original subscription identities must be retained; use the cancellation mutation'
            )
          const protectedRows = []
          // Resolve every root first, then lock in one deterministic order before touching records.
          const roots: FinancialRoot[] = []
          for (const candidate of method === 'create' ? candidates : prior) {
            const tier = await candidateTier(bound, candidate)
            roots.push({ type: tier.ownerType, id: candidate.referenceId })
          }
          await lockFinancialRoots(bound, roots)
          await refresh()
          for (let index = 0; index < candidates.length; index++) {
            const before = prior[index]?.id
              ? (
                  await bound
                    .select()
                    .from(schema.subscription)
                    .where(eq(schema.subscription.id, prior[index].id))
                    .limit(1)
                )[0]
              : undefined
            if (
              before &&
              (!roots.some(
                (root) => root.type === before.referenceType && root.id === before.referenceId
              ) ||
                before.plan !== before.billingTierId)
            )
              conflict('Original complete subscription root binding changed while waiting')
            protectedRows.push(
              await protectSubscription(
                bound,
                before,
                before ? { ...before, ...input.update } : candidates[index]
              )
            )
          }
          const result = await (delegate[method] as (input: any) => Promise<any>)(scopedInput)
          const ids = method === 'create' ? [result?.id] : prior.map((row) => row.id)
          for (let index = 0; index < ids.length; index++) {
            const id = ids[index]
            if (!id) conflict('Subscription mutation returned no stable ID')
            const { tier, root, customer, before, rotate, activation } = protectedRows[index]
            await bound
              .update(schema.subscription)
              .set({
                billingTierId: tier.id,
                referenceType: root.type,
                stripeCustomerId: customer ?? null,
              })
              .where(eq(schema.subscription.id, id))
            const [row] = await bound
              .select()
              .from(schema.subscription)
              .where(eq(schema.subscription.id, id))
              .limit(1)
            if (
              !row ||
              row.plan !== tier.id ||
              row.billingTierId !== tier.id ||
              row.referenceType !== root.type ||
              row.referenceId !== root.id ||
              row.stripeCustomerId !== (customer ?? null)
            )
              conflict('Complete subscription binding readback failed')
            await validateFinancialSeatCapacity(bound, row, tier)
            if (activation)
              await rotateSubscriptionAfterMutation(
                bound,
                activation.before,
                row,
                activation.rotate,
                activation.originalPeriod
              )
            else if (before) await rotateSubscriptionAfterMutation(bound, before, row, rotate)
          }
          return method === 'updateMany' ? prior.length : result
        }
        const roots = (method === 'create' ? candidates : prior).map((candidate) => ({
          type: 'organization' as const,
          id: candidate.organizationId ?? candidate.id,
        }))
        await lockFinancialRoots(bound, roots)
        await refresh()
        for (let index = 0; index < candidates.length; index++) {
          const before = prior[index]
          if (before && !roots.some((root) => root.id === (before.organizationId ?? before.id)))
            conflict('Original organization financial target changed while waiting')
          if (
            before &&
            (candidates[index].organizationId !== before.organizationId ||
              candidates[index].id !== before.id)
          )
            conflict('Existing organization financial targets cannot be transferred')
        }
        const result = await (delegate[method] as (input: any) => Promise<any>)(scopedInput)
        for (const root of roots) await assertOrganizationFinancialCapacity(bound, root.id)
        return method === 'updateMany' || method === 'deleteMany' ? prior.length : result
      }
      return tx ? run(tx) : db.transaction(run)
    }
    Object.assign(wrapped, { [method]: mutate })
  }
  wrapped.transaction = async (callback) => {
    if (tx) {
      const { transaction: _, ...bound } = wrapped
      return callback(bound)
    }
    return db.transaction(async (bound) => {
      const { transaction: _, ...adapter } = build(options, bound)
      return callback(adapter)
    })
  }
  return wrapped
}

/** Public configured factory; transaction callbacks retain the same policy wrapper. */
export const financialDrizzleAdapter: AdapterFactory = (options) => build(options)
