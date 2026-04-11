import { db } from '@tradinggoose/db'
import { workflow, workspace } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getActiveSubscriptionForReference } from '@/lib/billing/core/subscription'
import {
  type BillingScopeType,
  type BillingTierRecord,
  getSubscriptionBillingScope,
  requireDefaultBillingTier,
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

function getBillingOwnerId(billingOwner: WorkspaceBillingOwner): string {
  return billingOwner.type === 'organization' ? billingOwner.organizationId : billingOwner.userId
}

function getFallbackBillingScope(billingOwner: WorkspaceBillingOwner): {
  scopeId: string
  scopeType: BillingScopeType
  organizationId: string | null
  userId: string | null
} {
  return {
    scopeId: getBillingOwnerId(billingOwner),
    scopeType: billingOwner.type,
    organizationId: billingOwner.type === 'organization' ? billingOwner.organizationId : null,
    userId: billingOwner.type === 'user' ? billingOwner.userId : null,
  }
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
  const [subscription, defaultTier] = await Promise.all([
    getBillingOwnerSubscription(params.billingOwner),
    requireDefaultBillingTier(),
  ])

  const tier = subscription?.tier ?? defaultTier
  const billingUserId = resolveBillingUserId({
    ownerId: params.ownerId,
    billingOwner: params.billingOwner,
  })
  const scope = subscription
    ? getSubscriptionBillingScope(billingUserId, subscription)
    : getFallbackBillingScope(params.billingOwner)

  return {
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    billingUserId,
    billingOwner: params.billingOwner,
    subscription,
    tier,
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
