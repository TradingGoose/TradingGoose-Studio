import { db } from '@tradinggoose/db'
import { workflow, workspace } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getActiveSubscriptionForReference } from '@/lib/billing/core/subscription'
import {
  type BillingScope,
  type BillingScopeType,
  type BillingTierRecord,
  getSubscriptionBillingScope,
  type SubscriptionWithTier,
} from '@/lib/billing/tiers'
import { createLogger } from '@/lib/logs/console/logger'
import {
  serializeWorkspaceBillingOwner,
  type WorkspaceBillingOwner,
} from '@/lib/workspaces/billing-owner'

const logger = createLogger('WorkspaceBilling')

export interface WorkspaceBillingSettings {
  ownerId: string
  billingOwner: WorkspaceBillingOwner
  allowPersonalApiKeys: boolean
}

export interface WorkspaceBillingContext {
  workspaceId: string | null
  actorUserId: string | null
  billingUserId: string
  billingOwner: WorkspaceBillingOwner
  subscription: SubscriptionWithTier | null
  tier: BillingTierRecord
  scopeId: string
  scopeType: BillingScopeType
}

export function toRateLimitBillingScope(
  billingContext: WorkspaceBillingContext,
  actorUserId: string
): BillingScope {
  return {
    scopeType: billingContext.scopeType,
    scopeId: billingContext.scopeId,
    organizationId:
      billingContext.scopeType === 'organization_member' ||
      billingContext.scopeType === 'organization'
        ? billingContext.billingOwner.type === 'organization'
          ? billingContext.billingOwner.organizationId
          : null
        : null,
    userId:
      billingContext.scopeType === 'organization_member'
        ? actorUserId
        : billingContext.scopeType === 'user'
          ? billingContext.billingUserId
          : null,
  }
}

export function getBillingContextResolutionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''

  if (message.includes('No active subscription found')) {
    return 'No active subscription found for this workspace. Please configure billing before executing workflows.'
  }

  if (message.includes('missing billing owner')) {
    return 'Workspace billing is not configured correctly. Please update billing settings before executing workflows.'
  }

  return 'Unable to determine usage limits. Execution blocked until billing is configured correctly.'
}

function getBillingOwnerId(billingOwner: WorkspaceBillingOwner): string {
  return billingOwner.type === 'organization' ? billingOwner.organizationId : billingOwner.userId
}

function resolveBillingUserId(params: {
  ownerId: string | null
  billingOwner: WorkspaceBillingOwner
}): string {
  if (params.billingOwner.type === 'user') {
    return params.billingOwner.userId
  }

  // Organization billing keeps a stable workspace owner reference for user-scoped
  // actions, while the actual pooled billing ledger lives on the organization row.
  if (params.ownerId) {
    return params.ownerId
  }

  throw new Error('Organization-billed workspace is missing a stable workspace owner')
}

export async function getWorkspaceBillingSettings(
  workspaceId: string
): Promise<WorkspaceBillingSettings | null> {
  if (!workspaceId) {
    return null
  }

  const rows = await db
    .select({
      ownerId: workspace.ownerId,
      billingOwnerType: workspace.billingOwnerType,
      billingOwnerUserId: workspace.billingOwnerUserId,
      billingOwnerOrganizationId: workspace.billingOwnerOrganizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!rows.length) {
    return null
  }

  return {
    ownerId: rows[0].ownerId,
    billingOwner: serializeWorkspaceBillingOwner(rows[0]),
    allowPersonalApiKeys: rows[0].allowPersonalApiKeys ?? false,
  }
}

type ResolveWorkspaceBillingParams = {
  workspaceId?: string | null
  actorUserId?: string | null
}

async function getBillingOwnerSubscription(
  billingOwner: WorkspaceBillingOwner
): Promise<SubscriptionWithTier | null> {
  if (billingOwner.type === 'organization') {
    return getOrganizationSubscription(billingOwner.organizationId)
  }

  return getActiveSubscriptionForReference({
    referenceType: 'user',
    referenceId: billingOwner.userId,
  })
}

async function hydrateBillingContext(params: {
  workspaceId: string | null
  actorUserId: string | null
  ownerId: string | null
  billingOwner: WorkspaceBillingOwner
}): Promise<WorkspaceBillingContext> {
  const subscription = await getBillingOwnerSubscription(params.billingOwner)
  const billingUserId = resolveBillingUserId({
    ownerId: params.ownerId,
    billingOwner: params.billingOwner,
  })
  if (!subscription?.tier) {
    throw new Error(
      `No active subscription found for ${params.billingOwner.type} ${getBillingOwnerId(
        params.billingOwner
      )}`
    )
  }

  const scope = getSubscriptionBillingScope(billingUserId, subscription)

  return {
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    billingUserId,
    billingOwner: params.billingOwner,
    subscription,
    tier: subscription.tier,
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
  }
}

export async function resolveWorkspaceBillingContext(
  params: ResolveWorkspaceBillingParams
): Promise<WorkspaceBillingContext> {
  const workspaceId = params.workspaceId ?? null
  const actorUserId = params.actorUserId ?? null

  if (workspaceId) {
    const settings = await getWorkspaceBillingSettings(workspaceId)

    if (!settings) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    return hydrateBillingContext({
      workspaceId,
      actorUserId,
      ownerId: settings.ownerId,
      billingOwner: settings.billingOwner,
    })
  }

  if (!actorUserId) {
    throw new Error('Cannot resolve billing context without a workspace or actor user')
  }

  return hydrateBillingContext({
    workspaceId: null,
    actorUserId,
    ownerId: actorUserId,
    billingOwner: {
      type: 'user',
      userId: actorUserId,
    },
  })
}

export async function resolveWorkflowBillingContext(params: {
  workflowId: string
  actorUserId?: string | null
}): Promise<WorkspaceBillingContext> {
  const rows = await db
    .select({
      workflowUserId: workflow.userId,
      workspaceId: workflow.workspaceId,
      workspaceOwnerId: workspace.ownerId,
      billingOwnerType: workspace.billingOwnerType,
      billingOwnerUserId: workspace.billingOwnerUserId,
      billingOwnerOrganizationId: workspace.billingOwnerOrganizationId,
    })
    .from(workflow)
    .leftJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .where(eq(workflow.id, params.workflowId))
    .limit(1)

  if (!rows.length) {
    throw new Error(`Workflow ${params.workflowId} not found`)
  }

  const row = rows[0]
  const workspaceId = row.workspaceId ?? null
  const actorUserId = params.actorUserId ?? row.workflowUserId ?? null

  if (workspaceId && !row.billingOwnerType) {
    logger.error('Workflow workspace is missing billing owner', {
      workflowId: params.workflowId,
      workspaceId,
    })
    throw new Error(`Workspace ${workspaceId} is missing billing owner`)
  }

  return hydrateBillingContext({
    workspaceId,
    actorUserId,
    ownerId: row.workspaceOwnerId ?? row.workflowUserId,
    billingOwner:
      workspaceId && row.billingOwnerType
        ? serializeWorkspaceBillingOwner({
            billingOwnerType: row.billingOwnerType,
            billingOwnerUserId: row.billingOwnerUserId,
            billingOwnerOrganizationId: row.billingOwnerOrganizationId,
          })
        : {
            type: 'user',
            userId: actorUserId ?? row.workflowUserId,
          },
  })
}
