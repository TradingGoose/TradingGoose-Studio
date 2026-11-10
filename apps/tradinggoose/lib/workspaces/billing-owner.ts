import {
  assertFinancialRootClosed,
  FinancialPolicyError,
  type FinancialRoot,
  type FinancialTransaction,
  financialNamespace,
  lockFinancialRoots,
} from '@tradinggoose/billing'
import { db, member, permissions, subscription, workspace } from '@tradinggoose/db'
import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationSubscription } from '@/lib/billing/tiers'

type WorkspaceBillingOwnerColumns = Pick<
  typeof workspace.$inferInsert,
  'billingOwnerType' | 'billingOwnerUserId' | 'billingOwnerOrganizationId'
>

type WorkspaceBillingOwnerRecord = Pick<
  typeof workspace.$inferSelect,
  'billingOwnerType' | 'billingOwnerUserId' | 'billingOwnerOrganizationId'
>

export const workspaceBillingOwnerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user'),
    userId: z.string().trim().min(1, 'Billing owner user is required'),
  }),
  z.object({
    type: z.literal('organization'),
    organizationId: z.string().trim().min(1, 'Billing owner organization is required'),
  }),
])

type WorkspaceBillingOwnerInput = z.infer<typeof workspaceBillingOwnerSchema>

export class WorkspaceBillingOwnerUpdateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceBillingOwnerUpdateError'
  }
}

export type WorkspaceBillingOwner =
  | {
      type: 'user'
      userId: string
    }
  | {
      type: 'organization'
      organizationId: string
    }

export type WorkspacePermissionUpdate = {
  userId: string
  permissions: 'admin' | 'write' | 'read'
}

export function serializeWorkspaceBillingOwner(
  record: WorkspaceBillingOwnerRecord
): WorkspaceBillingOwner {
  if (record.billingOwnerType === 'organization') {
    if (!record.billingOwnerOrganizationId) {
      throw new Error('Workspace billing owner is missing organizationId')
    }

    return {
      type: 'organization',
      organizationId: record.billingOwnerOrganizationId,
    }
  }

  if (!record.billingOwnerUserId) {
    throw new Error('Workspace billing owner is missing userId')
  }

  return {
    type: 'user',
    userId: record.billingOwnerUserId,
  }
}

export function toWorkspaceApiRecord<T extends WorkspaceBillingOwnerRecord>(
  record: T
): Omit<T, keyof WorkspaceBillingOwnerRecord> & { billingOwner: WorkspaceBillingOwner } {
  const {
    billingOwnerType: _billingOwnerType,
    billingOwnerUserId: _billingOwnerUserId,
    billingOwnerOrganizationId: _billingOwnerOrganizationId,
    ...rest
  } = record

  return {
    ...rest,
    billingOwner: serializeWorkspaceBillingOwner(record),
  }
}

async function hasOrganizationBilledWorkspaces(
  organizationId: string,
  store: Pick<typeof db, 'select'> = db
): Promise<boolean> {
  const rows = await store
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.billingOwnerType, 'organization'),
        eq(workspace.billingOwnerOrganizationId, organizationId)
      )
    )
    .limit(1)

  return rows.length > 0
}

async function hasWorkspaceOwnedByBillingOrganization(
  args: { organizationId: string; workspaceOwnerId: string },
  store: Pick<typeof db, 'select'>
): Promise<boolean> {
  const rows = await store
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.ownerId, args.workspaceOwnerId),
        eq(workspace.billingOwnerType, 'organization'),
        eq(workspace.billingOwnerOrganizationId, args.organizationId)
      )
    )
    .limit(1)

  return rows.length > 0
}

async function hasBlockingOrganizationSubscription(
  organizationId: string,
  store: Pick<typeof db, 'select'> = db
): Promise<boolean> {
  const rows = await store
    .select({ id: subscription.id })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, 'organization'),
        eq(subscription.referenceId, organizationId),
        or(
          eq(subscription.status, 'active'),
          eq(subscription.status, 'trialing'),
          eq(subscription.cancelAtPeriodEnd, true)
        )
      )
    )
    .limit(1)

  return rows.length > 0
}

export async function assertWorkspaceOwnerCanLeaveBillingOrganization(
  args: { organizationId: string; workspaceOwnerId: string },
  store: Pick<typeof db, 'select'>
): Promise<void> {
  if (await hasWorkspaceOwnedByBillingOrganization(args, store)) {
    throw new FinancialPolicyError(
      'Workspace owner must reassign billing before leaving the organization'
    )
  }
}

export async function assertOrganizationCanBeDeleted(
  organizationId: string,
  store: FinancialTransaction
): Promise<void> {
  if (await hasOrganizationBilledWorkspaces(organizationId, store)) {
    throw new Error('Cannot delete an organization while workspaces are billed to it')
  }

  if (await hasBlockingOrganizationSubscription(organizationId, store)) {
    throw new Error('Cannot delete an organization while it still has a billing subscription')
  }
  await assertFinancialRootClosed(store, { type: 'organization', id: organizationId })
}

export function assertWorkspaceBillingOwnerRetainsAdminAccess(args: {
  billingOwnerType: 'user' | 'organization'
  billingOwnerUserId: string | null
  updates: WorkspacePermissionUpdate[]
}): void {
  if (args.billingOwnerType !== 'user') {
    return
  }

  if (!args.billingOwnerUserId) {
    throw new Error('Workspace billing owner is missing userId')
  }

  const billingOwnerUpdate = args.updates.find(
    (update) => update.userId === args.billingOwnerUserId
  )

  if (billingOwnerUpdate && billingOwnerUpdate.permissions !== 'admin') {
    throw new Error('Workspace billing owner must retain admin permissions')
  }
}

export function assertWorkspaceBillingOwnerCanBeRemoved(args: {
  billingOwnerType: 'user' | 'organization'
  billingOwnerUserId: string | null
  userId: string
}): void {
  if (args.billingOwnerType !== 'user') {
    return
  }

  if (!args.billingOwnerUserId) {
    throw new Error('Workspace billing owner is missing userId')
  }

  if (args.billingOwnerUserId === args.userId) {
    throw new Error('Cannot remove the workspace billing owner. Please reassign billing first.')
  }
}

async function hasOrganizationBillingAdminAccess(
  userId: string,
  organizationId: string,
  store: Pick<typeof db, 'select'> = db
): Promise<boolean> {
  const rows = await store
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, userId),
        eq(member.organizationId, organizationId),
        or(eq(member.role, 'owner'), eq(member.role, 'admin'))
      )
    )
    .limit(1)

  return rows.length > 0
}

async function isWorkspaceOwnerInOrganization(
  workspaceOwnerId: string,
  organizationId: string,
  store: Pick<typeof db, 'select'> = db
): Promise<boolean> {
  const rows = await store
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, workspaceOwnerId), eq(member.organizationId, organizationId)))
    .limit(1)

  return rows.length > 0
}

export async function resolveWorkspaceBillingOwnerUpdate(
  args: {
    actingUserId: string
    workspaceId: string
    workspaceOwnerId: string
    billingOwner: WorkspaceBillingOwnerInput
  },
  store: Pick<typeof db, 'select'> = db
): Promise<WorkspaceBillingOwnerColumns> {
  const { actingUserId, workspaceId, workspaceOwnerId, billingOwner } = args

  if (billingOwner.type === 'user') {
    const [access] = await store
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, billingOwner.userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.permissionType, 'admin')
        )
      )
      .limit(1)
    const hasAdminAccess = Boolean(access) || billingOwner.userId === workspaceOwnerId
    if (!hasAdminAccess) {
      throw new WorkspaceBillingOwnerUpdateError(
        'Workspace billing owner user must have admin access'
      )
    }

    return {
      billingOwnerType: 'user',
      billingOwnerUserId: billingOwner.userId,
      billingOwnerOrganizationId: null,
    }
  }

  const canManageOrganizationBilling = await hasOrganizationBillingAdminAccess(
    actingUserId,
    billingOwner.organizationId,
    store
  )

  if (!canManageOrganizationBilling) {
    throw new WorkspaceBillingOwnerUpdateError(
      'Only organization owners or admins can assign organization billing'
    )
  }

  const ownerBelongsToOrganization = await isWorkspaceOwnerInOrganization(
    workspaceOwnerId,
    billingOwner.organizationId,
    store
  )

  if (!ownerBelongsToOrganization) {
    throw new WorkspaceBillingOwnerUpdateError(
      'Workspace owner must belong to the billing organization'
    )
  }

  const organizationSubscription = await getOrganizationSubscription(
    billingOwner.organizationId,
    store
  )
  if (!isOrganizationSubscription(organizationSubscription)) {
    throw new WorkspaceBillingOwnerUpdateError(
      'Organization must have an active organization billing tier before workspaces can bill to it'
    )
  }

  return {
    billingOwnerType: 'organization',
    billingOwnerUserId: null,
    billingOwnerOrganizationId: billingOwner.organizationId,
  }
}

/** Lock both immutable payer roots before the workspace; waiting writers revalidate everything. */
export async function updateWorkspaceFinancialBinding(input: {
  actingUserId: string
  workspaceId: string
  billingOwner?: WorkspaceBillingOwner
  updates?: { name?: string; allowPersonalApiKeys?: boolean }
}) {
  return db.transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
      .limit(1)
    if (!initial) throw new WorkspaceBillingOwnerUpdateError('Workspace not found')
    const before = serializeWorkspaceBillingOwner(initial)
    const next = input.billingOwner ?? before
    const root = (owner: WorkspaceBillingOwner): FinancialRoot =>
      owner.type === 'organization'
        ? { type: 'organization', id: owner.organizationId }
        : { type: 'user', id: owner.userId }
    await lockFinancialRoots(tx, [root(before), root(next)])
    const [fresh] = await tx
      .select()
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
      .for('update')
      .limit(1)
    if (
      !fresh ||
      financialNamespace(root(serializeWorkspaceBillingOwner(fresh))) !==
        financialNamespace(root(before))
    )
      throw new WorkspaceBillingOwnerUpdateError('Workspace billing changed while waiting; retry')
    const [access] = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, input.actingUserId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, input.workspaceId),
          eq(permissions.permissionType, 'admin')
        )
      )
      .limit(1)
    if (!access && fresh.ownerId !== input.actingUserId)
      throw new WorkspaceBillingOwnerUpdateError('Workspace admin access required')
    const billing = input.billingOwner
      ? await resolveWorkspaceBillingOwnerUpdate(
          {
            actingUserId: input.actingUserId,
            workspaceId: input.workspaceId,
            workspaceOwnerId: fresh.ownerId,
            billingOwner: next,
          },
          tx
        )
      : {}
    const [updated] = await tx
      .update(workspace)
      .set({ ...input.updates, ...billing, updatedAt: new Date() })
      .where(eq(workspace.id, input.workspaceId))
      .returning()
    return updated
  })
}
