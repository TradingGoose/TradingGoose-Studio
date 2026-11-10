import { randomUUID } from 'node:crypto'
import {
  acceptModelStep,
  admitModelStep,
  createInvocation,
  type FinancialBinding,
  FinancialPolicyError,
  financialFingerprint,
  type ModelOccurrence,
  occurrenceKey,
  verifyAcceptance,
} from '@tradinggoose/billing'
import { monetary } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'

export type { FinancialBinding, ModelOccurrence } from '@tradinggoose/billing'

/** Deployment sets this only after authenticated schedule/index/drain verification. */
export function financialSchedulerReady(): boolean {
  return process.env.BILLING_DISPATCH_READY === 'true' && Boolean(process.env.CRON_SECRET?.trim())
}

export function createFinancialInvocation(input: {
  actorUserId: string
  workspaceId?: string | null
  workflowId?: string | null
  runId: string
  purpose: string
  operationKey?: string
  quotedHoldUsd?: string
  billable?: boolean
  /** Restrictive server-owned payer continuity check; never persisted as canonical input. */
  expectedNamespace?: string
}): Promise<FinancialBinding> {
  const { expectedNamespace, ...invocation } = input
  return db.transaction(async (tx) => {
    if (expectedNamespace !== undefined && !expectedNamespace.trim())
      throw new FinancialPolicyError('Original financial namespace is required', 403)
    const binding = await createInvocation(tx, {
      ...invocation,
      operationKey: invocation.operationKey ?? randomUUID(),
      schedulerReady: financialSchedulerReady(),
    })
    if (expectedNamespace !== undefined && binding.namespace !== expectedNamespace)
      throw new FinancialPolicyError('Original financial payer changed before child contact', 403)
    return binding
  })
}

export function admitFinancialModelStep(binding: FinancialBinding, occurrence: ModelOccurrence) {
  return db.transaction((tx) => admitModelStep(tx, binding, occurrence, financialSchedulerReady()))
}

export async function acceptFinancialModelStep(
  binding: FinancialBinding,
  occurrence: ModelOccurrence & { usage?: unknown }
) {
  const originalBinding = { ...binding }
  const originalOccurrence = { ...occurrence }
  const bindingFingerprint = financialFingerprint(originalBinding)
  const receiptFingerprint = financialFingerprint([
    originalBinding.fingerprint,
    occurrenceKey(originalBinding, originalOccurrence),
  ])
  const receipt = await db.transaction((tx) =>
    acceptModelStep(tx, originalBinding, originalOccurrence, { usage: originalOccurrence.usage })
  )
  if (
    !receipt ||
    receipt.recordType !== 'operation' ||
    receipt.contactState !== 'accepted' ||
    receipt.holdState !== 'closed' ||
    typeof receipt.appliedUsd !== 'string' ||
    monetary(receipt.appliedUsd) !== receipt.appliedUsd ||
    receipt.fingerprint !== receiptFingerprint ||
    !receipt.binding ||
    financialFingerprint(receipt.binding) !== bindingFingerprint
  )
    throw new FinancialPolicyError('Financial model acceptance was not acknowledged')
  return receipt
}

export function verifyFinancialAcceptance(binding: FinancialBinding, occurrence: ModelOccurrence) {
  return db.transaction((tx) => verifyAcceptance(tx, binding, occurrence))
}

export async function withFinancialRootMutation<T>(
  roots: import('@tradinggoose/billing').FinancialRoot[],
  mutation: (tx: import('@tradinggoose/billing').FinancialTransaction) => Promise<T>
): Promise<T> {
  const { lockFinancialRoots } = await import('@tradinggoose/billing')
  return db.transaction(async (tx) => {
    await lockFinancialRoots(tx, roots)
    return mutation(tx)
  })
}

export function acceptFinancialBusinessOperation(
  binding: FinancialBinding,
  facts: {
    executionTimeMs?: number
    executionTrigger?: 'manual' | 'api' | 'webhook' | 'schedule' | 'chat'
  }
) {
  return db.transaction((tx) =>
    acceptModelStep(tx, binding, { stepNumber: 0, retryCount: 0 }, facts)
  )
}
