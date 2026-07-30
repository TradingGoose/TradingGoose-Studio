import type { BillingTierRecord } from '@/lib/billing/tiers'
import type { BlockLog } from '@/executor/types'

export const WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED =
  'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED' as const

const POSITIVE_DECIMAL = /^(?:0*[1-9]\d*(?:\.\d*)?|0*\.\d*[1-9]\d*)$/

function incrementIntegerString(value: string): string {
  const digits = value.split('')
  let carry = 1
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    const next = Number(digits[index]) + carry
    digits[index] = String(next % 10)
    carry = next >= 10 ? 1 : 0
  }
  return carry ? `1${digits.join('')}` : digits.join('')
}

export function normalizePositiveDecimal(value: string): string {
  const trimmed = value.trim()
  if (!POSITIVE_DECIMAL.test(trimmed)) {
    throw new Error('Workflow execution time limit must be a finite positive number of seconds')
  }
  const [integerPart, fractionPart] = trimmed.split('.')
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0'
  const fraction = fractionPart?.replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : integer
}

export function secondsToCeilMicroseconds(seconds: string): string {
  const normalized = normalizePositiveDecimal(seconds)
  const [integerPart, fractionPart = ''] = normalized.split('.')
  const firstSix = fractionPart.slice(0, 6).padEnd(6, '0')
  let microseconds = `${integerPart}${firstSix}`.replace(/^0+(?=\d)/, '') || '0'
  if (fractionPart.slice(6).includes('1') || /[2-9]/.test(fractionPart.slice(6))) {
    microseconds = incrementIntegerString(microseconds)
  }
  return microseconds === '0' ? '1' : microseconds
}

export type WorkflowExecutionTimePolicy =
  | {
      kind: 'unlimited'
      rootExecutionId: string
      appliedTierId: string
      processingStartedAt: string
    }
  | {
      kind: 'bounded'
      rootExecutionId: string
      appliedTierId: string
      processingStartedAt: string
      limitSeconds: string
      limitMicroseconds: string
    }

export function isWorkflowExecutionTimePolicy(
  value: unknown
): value is WorkflowExecutionTimePolicy {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.rootExecutionId !== 'string' ||
    typeof candidate.processingStartedAt !== 'string'
  ) {
    return false
  }
  if (candidate.kind === 'unlimited') {
    return typeof candidate.appliedTierId === 'string'
  }
  return (
    candidate.kind === 'bounded' &&
    typeof candidate.appliedTierId === 'string' &&
    typeof candidate.limitSeconds === 'string' &&
    typeof candidate.limitMicroseconds === 'string'
  )
}

export function createWorkflowExecutionTimePolicy(params: {
  rootExecutionId: string
  processingStartedAt: string
  tier: BillingTierRecord
}): WorkflowExecutionTimePolicy {
  const tier = params.tier
  const configured = tier.workflowExecutionTimeLimitSeconds
  if (configured === null || configured === undefined) {
    return {
      kind: 'unlimited',
      rootExecutionId: params.rootExecutionId,
      appliedTierId: tier.id,
      processingStartedAt: params.processingStartedAt,
    }
  }
  const limitSeconds = normalizePositiveDecimal(configured)
  return {
    kind: 'bounded',
    rootExecutionId: params.rootExecutionId,
    appliedTierId: tier.id,
    processingStartedAt: params.processingStartedAt,
    limitSeconds,
    limitMicroseconds: secondsToCeilMicroseconds(limitSeconds),
  }
}

export type WorkflowDeadlineMetadata = {
  appliedTierId: string
  limitSeconds: string
  processingStartedAt: string
  terminatedAt: string
}

export function isWorkflowDeadlineMetadata(value: unknown): value is WorkflowDeadlineMetadata {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return [
    candidate.appliedTierId,
    candidate.limitSeconds,
    candidate.processingStartedAt,
    candidate.terminatedAt,
  ].every((field) => typeof field === 'string' && field.trim().length > 0)
}

export function createWorkflowDeadlineResult(params: {
  policy: Extract<WorkflowExecutionTimePolicy, { kind: 'bounded' }>
  terminatedAt: string
  output?: Record<string, unknown>
  logs?: BlockLog[]
}) {
  return {
    success: false as const,
    output: params.output ?? {},
    error: 'Workflow execution time limit exceeded',
    code: WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED,
    logs: params.logs ?? [],
    deadline: {
      appliedTierId: params.policy.appliedTierId,
      limitSeconds: params.policy.limitSeconds,
      processingStartedAt: params.policy.processingStartedAt,
      terminatedAt: params.terminatedAt,
    } satisfies WorkflowDeadlineMetadata,
  }
}
