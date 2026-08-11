import type { BillingTierRecord } from '@/lib/billing/tiers'
import type { BlockLog } from '@/executor/types'

export const WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED =
  'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED' as const

export const NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE = false

type ResolvedTierIdentity = {
  source: 'resolved-tier'
  appliedTierId: string
  appliedTierName: string
}

export type WorkflowExecutionTimePolicy =
  | {
      kind: 'bounded'
      processingStartedAt: string
      tier: ResolvedTierIdentity
      limitSeconds: number
      accounting:
        | { mode: 'remaining'; remainingMilliseconds: number }
        | { mode: 'absolute'; expiresAt: string }
    }
  | {
      kind: 'unlimited'
      processingStartedAt: string
      tier: ResolvedTierIdentity | { source: 'no-tier' }
    }

export interface WorkflowExecutionTimeBudget {
  registerActivity(slotId: string): void
  markQueuedChildWait(slotId: string): void
  observeChildProcessing(slotId: string, startedAt: string, completedAt?: string): void
  closeActivity(slotId: string): void
  snapshotPolicy(): WorkflowExecutionTimePolicy
  mergeChildRemaining(remainingMilliseconds: number): void
  remainingMilliseconds(): number | null
}

export function isWorkflowExecutionTimePolicy(
  value: unknown
): value is WorkflowExecutionTimePolicy {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    (candidate.kind !== 'bounded' && candidate.kind !== 'unlimited') ||
    typeof candidate.processingStartedAt !== 'string' ||
    !candidate.tier ||
    typeof candidate.tier !== 'object' ||
    Array.isArray(candidate.tier)
  ) {
    return false
  }
  const validTimestamp = (timestamp: unknown) => {
    if (typeof timestamp !== 'string' || timestamp.length === 0) return false
    const milliseconds = Date.parse(timestamp)
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === timestamp
  }
  if (!validTimestamp(candidate.processingStartedAt)) {
    return false
  }
  const tier = candidate.tier as Record<string, unknown>
  const hasOnlyKeys = (target: Record<string, unknown>, allowed: string[]) =>
    Object.keys(target).every((key) => allowed.includes(key))
  const resolvedTier =
    tier.source === 'resolved-tier' &&
    hasOnlyKeys(tier, ['source', 'appliedTierId', 'appliedTierName']) &&
    typeof tier.appliedTierId === 'string' &&
    tier.appliedTierId.length > 0 &&
    typeof tier.appliedTierName === 'string' &&
    tier.appliedTierName.length > 0

  if (candidate.kind === 'unlimited') {
    const validUnlimitedTier =
      (tier.source === 'no-tier' && hasOnlyKeys(tier, ['source'])) || resolvedTier
    return validUnlimitedTier && hasOnlyKeys(candidate, ['kind', 'processingStartedAt', 'tier'])
  }
  if (
    !resolvedTier ||
    !hasOnlyKeys(candidate, [
      'kind',
      'processingStartedAt',
      'tier',
      'limitSeconds',
      'accounting',
    ]) ||
    typeof candidate.limitSeconds !== 'number' ||
    !Number.isFinite(candidate.limitSeconds) ||
    candidate.limitSeconds <= 0 ||
    !candidate.accounting ||
    typeof candidate.accounting !== 'object'
  ) {
    return false
  }
  const limitMilliseconds = candidate.limitSeconds * 1000
  if (!Number.isFinite(limitMilliseconds) || limitMilliseconds > Number.MAX_SAFE_INTEGER)
    return false
  const accounting = candidate.accounting as Record<string, unknown>
  if (accounting.mode === 'remaining') {
    return (
      hasOnlyKeys(accounting, ['mode', 'remainingMilliseconds']) &&
      typeof accounting.remainingMilliseconds === 'number' &&
      Number.isFinite(accounting.remainingMilliseconds) &&
      accounting.remainingMilliseconds >= 0 &&
      accounting.remainingMilliseconds <= limitMilliseconds
    )
  }
  return (
    accounting.mode === 'absolute' &&
    hasOnlyKeys(accounting, ['mode', 'expiresAt']) &&
    validTimestamp(accounting.expiresAt) &&
    accounting.expiresAt ===
      new Date(Date.parse(candidate.processingStartedAt) + limitMilliseconds).toISOString()
  )
}

export function createWorkflowExecutionTimePolicy(params: {
  processingStartedAt: string
  tier: BillingTierRecord | null
}): WorkflowExecutionTimePolicy {
  const { processingStartedAt, tier } = params
  if (!tier) {
    return {
      kind: 'unlimited',
      processingStartedAt,
      tier: { source: 'no-tier' },
    }
  }

  const identity: ResolvedTierIdentity = {
    source: 'resolved-tier',
    appliedTierId: tier.id,
    appliedTierName: tier.displayName,
  }
  const limitSeconds = tier.workflowExecutionTimeLimitSeconds
  if (limitSeconds === null) {
    return { kind: 'unlimited', processingStartedAt, tier: identity }
  }
  if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) {
    throw new Error(`Billing tier ${tier.displayName} has an invalid workflow execution time limit`)
  }
  const limitMilliseconds = limitSeconds * 1000
  if (!Number.isFinite(limitMilliseconds) || limitMilliseconds > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Billing tier ${tier.displayName} workflow execution time limit is unsafe`)
  }

  return {
    kind: 'bounded',
    processingStartedAt,
    tier: identity,
    limitSeconds,
    accounting: NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE
      ? {
          mode: 'absolute',
          expiresAt: new Date(
            new Date(processingStartedAt).getTime() + limitMilliseconds
          ).toISOString(),
        }
      : { mode: 'remaining', remainingMilliseconds: limitMilliseconds },
  }
}

export function getWorkflowExecutionTimeLimitMilliseconds(
  policy: WorkflowExecutionTimePolicy
): number | null {
  if (policy.kind === 'unlimited') return null
  return policy.accounting.mode === 'remaining'
    ? policy.accounting.remainingMilliseconds
    : Math.max(0, new Date(policy.accounting.expiresAt).getTime() - Date.now())
}

export function materializeInheritedWorkflowExecutionTimePolicy(params: {
  policy: WorkflowExecutionTimePolicy
  capturedAt: string
  materializedAt: string
}): WorkflowExecutionTimePolicy {
  const { policy } = params
  if (policy.kind !== 'bounded' || policy.accounting.mode !== 'remaining') return policy

  const capturedAt = Date.parse(params.capturedAt)
  const materializedAt = Date.parse(params.materializedAt)
  if (!Number.isFinite(capturedAt) || !Number.isFinite(materializedAt)) {
    throw new Error('Inherited workflow execution time policy has an invalid timestamp')
  }

  return {
    ...policy,
    accounting: {
      mode: 'remaining',
      remainingMilliseconds: Math.max(
        0,
        policy.accounting.remainingMilliseconds - Math.max(0, materializedAt - capturedAt)
      ),
    },
  }
}

export function createWorkflowExecutionDeadlineResult(
  policy: Extract<WorkflowExecutionTimePolicy, { kind: 'bounded' }>,
  terminatedAt: string,
  logs: BlockLog[]
) {
  const error = `Workflow execution stopped because it reached the ${policy.limitSeconds}-second Workflow Execution Time Limit for the "${policy.tier.appliedTierName}" tier.`
  return {
    success: false as const,
    output: {},
    error,
    code: WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED,
    logs: logs.map((log) =>
      log.code === WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED ? { ...log, error } : log
    ),
    deadline: {
      appliedTierId: policy.tier.appliedTierId,
      appliedTierName: policy.tier.appliedTierName,
      limitSeconds: policy.limitSeconds,
      processingStartedAt: policy.processingStartedAt,
      terminatedAt,
    },
  }
}
