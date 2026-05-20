import { AuthType } from '@/lib/auth/hybrid'
import { getActiveSubscriptionForReference } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import type { BillingReference, BillingScopeType, BillingTierRecord } from '@/lib/billing/tiers'
import {
  getBillingContextResolutionMessage,
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
  toRateLimitBillingScope,
} from '@/lib/billing/workspace-billing'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import type { TriggerType } from '@/services/queue'

type ExecutionLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

type ExecutionBillingContext = Awaited<ReturnType<typeof resolveWorkspaceBillingContext>>

const logger = createLogger('ExecutionConcurrencyLimit')

export class ExecutionGateError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 402) {
    super(message)
    this.name = 'ExecutionGateError'
    this.statusCode = statusCode
  }
}

export async function resolveServerExecutionBillingContext(params: {
  actorUserId: string
  workflowId?: string | null
  workspaceId?: string | null
  logger?: ExecutionLogger
  requestId?: string
  source?: string
}): Promise<ExecutionBillingContext | null> {
  if (!(await isBillingEnabledForRuntime())) {
    return null
  }

  try {
    return params.workflowId
      ? await resolveWorkflowBillingContext({
          workflowId: params.workflowId,
          actorUserId: params.actorUserId,
        })
      : await resolveWorkspaceBillingContext({
          workspaceId: params.workspaceId,
          actorUserId: params.actorUserId,
        })
  } catch (error) {
    if (!isProd) {
      params.logger?.warn(
        `[${params.requestId ?? 'execution'}] Failed to resolve ${params.source ?? 'execution'} billing context; continuing without billing limits in local development`,
        {
          actorUserId: params.actorUserId,
          workflowId: params.workflowId,
          workspaceId: params.workspaceId,
          error,
        }
      )
      return null
    }

    params.logger?.warn(
      `[${params.requestId ?? 'execution'}] Failed to resolve ${params.source ?? 'execution'} billing context`,
      {
        actorUserId: params.actorUserId,
        workflowId: params.workflowId,
        workspaceId: params.workspaceId,
        error,
      }
    )
    throw new ExecutionGateError(getBillingContextResolutionMessage(error))
  }
}

function getBillingReferenceForScope(params: {
  scopeId: string
  scopeType: string
}): BillingReference {
  if (params.scopeType === 'user' || params.scopeType === 'organization') {
    return {
      referenceType: params.scopeType,
      referenceId: params.scopeId,
    }
  }

  if (params.scopeType === 'organization_member') {
    const [organizationId, userId] = params.scopeId.split(':')
    if (!organizationId || !userId) {
      throw new Error(`Invalid organization member billing scope: ${params.scopeId}`)
    }
    return {
      referenceType: 'organization',
      referenceId: organizationId,
    }
  }

  throw new Error(`Unsupported billing scope type: ${params.scopeType}`)
}

export async function resolveServerExecutionBillingTierForScope(params: {
  scopeId: string
  scopeType: BillingScopeType | string
}): Promise<BillingTierRecord | null> {
  if (!(await isBillingEnabledForRuntime())) {
    return null
  }

  try {
    const subscription = await getActiveSubscriptionForReference(
      getBillingReferenceForScope(params)
    )

    if (!subscription?.tier) {
      throw new Error(`No active subscription found for billing scope ${params.scopeId}`)
    }

    return subscription.tier
  } catch (error) {
    if (!isProd) {
      const missingSubscription =
        error instanceof Error && error.message.includes('No active subscription')

      if (!missingSubscription) {
        throw error
      }

      logger.warn(
        '[execution] Failed to resolve execution billing tier; continuing without concurrency limits in local development',
        {
          scopeId: params.scopeId,
          scopeType: params.scopeType,
          error,
        }
      )

      return null
    }

    throw new ExecutionGateError(getBillingContextResolutionMessage(error))
  }
}

export async function enforceServerExecutionRateLimit(params: {
  actorUserId: string
  authType?: string
  workflowId?: string | null
  workspaceId?: string | null
  isAsync: boolean
  logger: ExecutionLogger
  requestId: string
  source: string
  triggerType?: TriggerType
}) {
  const triggerType =
    params.triggerType ?? (params.authType === AuthType.API_KEY ? 'api' : 'manual')
  if (triggerType === 'manual') {
    return
  }

  const billingContext = await resolveServerExecutionBillingContext(params)
  if (!billingContext) {
    return
  }

  const { ExecutionLimiter, RateLimitError } = await import('@/services/queue')
  const rateLimiter = new ExecutionLimiter()
  const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
    billingContext.billingUserId,
    billingContext.subscription,
    triggerType,
    params.isAsync,
    toRateLimitBillingScope(billingContext, params.actorUserId)
  )

  if (!rateLimitCheck.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded. You have ${rateLimitCheck.remaining} requests remaining. Resets at ${rateLimitCheck.resetAt.toISOString()}`
    )
  }

  return rateLimitCheck
}
