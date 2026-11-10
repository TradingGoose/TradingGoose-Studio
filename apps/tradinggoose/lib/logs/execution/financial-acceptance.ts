import { type FinancialBinding, FinancialPolicyError } from '@tradinggoose/billing'
import { verifyFinancialAcceptance } from '@/lib/billing/native-finance'

export type WorkflowFinancialLog = {
  id: string
  executionId: string | null
  workspaceId: string
  workflowId: string | null
  workflowSummary: unknown
  executionData: unknown
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function bindingValue(value: unknown): value is FinancialBinding {
  return (
    record(value) &&
    ['namespace', 'key', 'fingerprint', 'runId', 'actorUserId', 'purpose'].every(
      (field) => typeof value[field] === 'string' && value[field].length > 0
    ) &&
    (value.workspaceId === null || typeof value.workspaceId === 'string') &&
    (value.workflowId === null || typeof value.workflowId === 'string')
  )
}

/** Read only: a preserved functional outcome never substitutes for its original financial receipt. */
export async function verifyWorkflowFinancialAcceptance(row: WorkflowFinancialLog) {
  const data = record(row.executionData) ? row.executionData : {}
  const environment = record(data.environment) ? data.environment : {}
  const billing = record(data.billing) ? data.billing : {}
  const binding = billing.binding
  const summary = record(row.workflowSummary) ? row.workflowSummary : {}
  const workflowId = row.workflowId ?? summary.id
  if (
    !row.id ||
    !row.executionId ||
    !row.workspaceId ||
    typeof workflowId !== 'string' ||
    !workflowId ||
    (summary.id !== undefined && summary.id !== workflowId) ||
    !bindingValue(binding) ||
    binding.purpose !== 'workflow-execution' ||
    binding.key !== `invocation:${row.executionId}` ||
    binding.runId !== row.executionId ||
    binding.workspaceId !== row.workspaceId ||
    binding.workflowId !== workflowId ||
    environment.executionId !== row.executionId ||
    environment.workspaceId !== row.workspaceId ||
    environment.workflowId !== workflowId ||
    environment.userId !== binding.actorUserId
  )
    throw new FinancialPolicyError(
      'Original workflow financial binding scope is missing or conflicting'
    )
  return verifyFinancialAcceptance(binding, {
    stepNumber: 0,
    retryCount: 0,
    runId: row.executionId,
  })
}
