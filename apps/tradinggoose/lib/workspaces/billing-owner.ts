import { db, member, subscription, workspace } from '@tradinggoose/db'
import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationSubscription } from '@/lib/billing/tiers'
import { hasWorkspaceAdminAccess } from '@/lib/permissions/utils'

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

async function hasOrganizationBilledWorkspaces(organizationId: string): Promise<boolean> {
  const rows = await db
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

async function hasWorkspaceOwnedByBillingOrganization(args: {
  organizationId: string
  workspaceOwnerId: string
}): Promise<boolean> {
  const rows = await db
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

async function hasBlockingOrganizationSubscription(organizationId: string): Promise<boolean> {
  const rows = await db
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

export async function assertWorkspaceOwnerCanLeaveBillingOrganization(args: {
  organizationId: string
  workspaceOwnerId: string
}): Promise<void> {
  if (await hasWorkspaceOwnedByBillingOrganization(args)) {
    throw new Error('Workspace owner must reassign billing before leaving the organization')
  }
}

export async function assertOrganizationCanBeDeleted(organizationId: string): Promise<void> {
  if (await hasOrganizationBilledWorkspaces(organizationId)) {
    throw new Error('Cannot delete an organization while workspaces are billed to it')
  }

  if (await hasBlockingOrganizationSubscription(organizationId)) {
    throw new Error('Cannot delete an organization while it still has a billing subscription')
  }
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
  organizationId: string
): Promise<boolean> {
  const rows = await db
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
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, workspaceOwnerId), eq(member.organizationId, organizationId)))
    .limit(1)

  return rows.length > 0
}

export async function resolveWorkspaceBillingOwnerUpdate(args: {
  actingUserId: string
  workspaceId: string
  workspaceOwnerId: string
  billingOwner: WorkspaceBillingOwnerInput
}): Promise<WorkspaceBillingOwnerColumns> {
  const { actingUserId, workspaceId, workspaceOwnerId, billingOwner } = args

  if (billingOwner.type === 'user') {
    const hasAdminAccess = await hasWorkspaceAdminAccess(billingOwner.userId, workspaceId)
    if (!hasAdminAccess) {
      throw new Error('Workspace billing owner user must have admin access')
    }

    return {
      billingOwnerType: 'user',
      billingOwnerUserId: billingOwner.userId,
      billingOwnerOrganizationId: null,
    }
  }

  const canManageOrganizationBilling = await hasOrganizationBillingAdminAccess(
    actingUserId,
    billingOwner.organizationId
  )

  if (!canManageOrganizationBilling) {
    throw new Error('Only organization owners or admins can assign organization billing')
  }

  const ownerBelongsToOrganization = await isWorkspaceOwnerInOrganization(
    workspaceOwnerId,
    billingOwner.organizationId
  )

  if (!ownerBelongsToOrganization) {
    throw new Error('Workspace owner must belong to the billing organization')
  }

  const organizationSubscription = await getOrganizationSubscription(billingOwner.organizationId)
  if (!isOrganizationSubscription(organizationSubscription)) {
    throw new Error(
      'Organization must have an active organization billing tier before workspaces can bill to it'
    )
  }

  return {
    billingOwnerType: 'organization',
    billingOwnerUserId: null,
    billingOwnerOrganizationId: billingOwner.organizationId,
  }
}
