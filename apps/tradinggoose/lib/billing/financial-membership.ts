import {
  FinancialPolicyError,
  type FinancialTransaction,
  initializeFinancialMemberRegistry,
  lockFinancialRoots,
  registerFinancialMember,
} from '@tradinggoose/billing'
import { db } from '@tradinggoose/db'
import {
  invitation,
  member,
  organization,
  subscription,
  systemBillingTier,
  systemSettings,
  user,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { validateFinancialSeatCapacity } from '@/lib/billing/financial-subscriptions'
import { getOrganizationAccessState } from '@/lib/organization/access'

/** Actual organization, creator membership and financial coverage commit together. */
export async function createOrganizationWithFinancialRegistration(input: {
  actorUserId: string
  name: string
  slug: string
}) {
  return db.transaction(async (tx) => {
    const organizationId = crypto.randomUUID()
    const root = { type: 'organization' as const, id: organizationId }
    await initializeFinancialMemberRegistry(tx, organizationId, async () => {
      await tx
        .insert(organization)
        .values({ id: organizationId, name: input.name, slug: input.slug })
      await lockFinancialRoots(tx, [root, { type: 'user', id: input.actorUserId }])
      const [membership] = await tx
        .select({ id: member.id })
        .from(member)
        .where(eq(member.userId, input.actorUserId))
        .limit(1)
      const [flags] = await tx
        .select({ enabled: systemSettings.billingEnabled })
        .from(systemSettings)
        .where(eq(systemSettings.id, 'global'))
        .limit(1)
      if (
        !getOrganizationAccessState({
          billingEnabled: flags?.enabled ?? false,
          hasOrganization: Boolean(membership),
          isOrganizationAdmin: false,
        }).canCreateOrganization
      )
        throw new FinancialPolicyError('Current account cannot create another organization', 403)
      const matches = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, input.slug))
      if (matches.some((row) => row.id !== organizationId))
        throw new FinancialPolicyError('This slug is already taken', 400)
    })
    await registerFinancialMember(tx, { organizationId, userId: input.actorUserId }, () =>
      tx.insert(member).values({
        id: crypto.randomUUID(),
        organizationId,
        userId: input.actorUserId,
        role: 'owner',
        createdAt: new Date(),
      })
    )
    await assertOrganizationFinancialCapacity(tx, organizationId)
    return organizationId
  })
}

export async function assertOrganizationFinancialCapacity(
  tx: FinancialTransaction,
  organizationId: string
) {
  const [flags] = await tx
    .select({ billingEnabled: systemSettings.billingEnabled })
    .from(systemSettings)
    .where(eq(systemSettings.id, 'global'))
    .limit(1)
  if (!flags?.billingEnabled) return
  const rows = await tx
    .select({ subscription, tier: systemBillingTier })
    .from(subscription)
    .innerJoin(systemBillingTier, eq(subscription.billingTierId, systemBillingTier.id))
    .where(
      and(
        eq(subscription.referenceType, 'organization'),
        eq(subscription.referenceId, organizationId),
        inArray(subscription.status, ['active', 'trialing', 'past_due'])
      )
    )
  if (!rows.length) {
    const [members] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    const [pending] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(invitation)
      .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
    if (Number(members.count) > 1 || Number(pending.count) > 0)
      throw new FinancialPolicyError(
        'Organization subscription must be configured before admitting more seats'
      )
    return
  }
  if (
    rows.length !== 1 ||
    rows[0].subscription.plan !== rows[0].tier.id ||
    rows[0].tier.ownerType !== 'organization'
  )
    throw new FinancialPolicyError('Organization financial subscription is ambiguous')
  await validateFinancialSeatCapacity(tx, rows[0].subscription, rows[0].tier)
}

export async function mutateOrganizationFinancialScope<T>(
  organizationId: string,
  mutation: (tx: FinancialTransaction) => Promise<T>,
  authorization?: {
    actorUserId: string
    targetUserId?: string
    requestedRole?: string
    allowSelfRemoval?: boolean
  }
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [{ type: 'organization', id: organizationId }])
    if (authorization) {
      const [actor] = await tx
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, authorization.actorUserId)
          )
        )
        .limit(1)
      const self =
        authorization.targetUserId === authorization.actorUserId && authorization.allowSelfRemoval
      if (!actor || (!self && !['owner', 'admin'].includes(actor.role)))
        throw new FinancialPolicyError('Current organization administrator access required', 403)
      if (authorization.requestedRole === 'admin' && actor.role !== 'owner')
        throw new FinancialPolicyError(
          'Current owner authorization required to grant administrator access',
          403
        )
      if (authorization.targetUserId) {
        const [target] = await tx
          .select({ role: member.role })
          .from(member)
          .where(
            and(
              eq(member.organizationId, organizationId),
              eq(member.userId, authorization.targetUserId)
            )
          )
          .limit(1)
        if (!target) throw new FinancialPolicyError('Organization member no longer exists', 404)
        if (
          target.role === 'owner' ||
          (target.role === 'admin' && actor.role !== 'owner' && !self) ||
          (authorization.requestedRole === 'admin' && actor.role !== 'owner')
        )
          throw new FinancialPolicyError(
            'Current owner authorization required for that member change',
            403
          )
      }
    }
    const result = await mutation(tx)
    await assertOrganizationFinancialCapacity(tx, organizationId)
    return result
  })
}

export async function createFinancialInvitations(
  organizationId: string,
  rows: Array<typeof invitation.$inferInsert>,
  actorUserId: string
) {
  return mutateOrganizationFinancialScope(
    organizationId,
    async (tx) => {
      for (const row of rows) {
        if (
          row.organizationId !== organizationId ||
          row.inviterId !== actorUserId ||
          !['member', 'admin'].includes(row.role ?? '')
        )
          throw new FinancialPolicyError('Invitation original financial scope is invalid', 400)
        const [existing] = await tx
          .select({ id: invitation.id })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, organizationId),
              eq(invitation.email, row.email),
              eq(invitation.status, 'pending')
            )
          )
          .limit(1)
        const [existingMember] = await tx
          .select({ id: member.id })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(and(eq(member.organizationId, organizationId), eq(user.email, row.email)))
          .limit(1)
        if (existing || existingMember)
          throw new FinancialPolicyError(
            'Email already has organization access or a pending invitation',
            409
          )
      }
      return tx.insert(invitation).values(rows)
    },
    { actorUserId, requestedRole: rows.some((row) => row.role === 'admin') ? 'admin' : 'member' }
  )
}
