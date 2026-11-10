import type { NativePayloadRef } from '@/lib/mastra/workflow-history'

// A disposable reader seam for orchestration tests. Native persistence/readback is tested separately.
const payloads = new WeakMap<object, Record<string, unknown>>()
export function canonicalLogFixture(row: any): any {
  let executionData = row.executionData ?? {}
  const id = row.id ?? 'fixture-log'
  const workspaceId = row.workspaceId ?? 'workspace-1'
  const executionId = row.executionId ?? 'execution-1'
  const workflowId = row.workflowId ?? row.workflowSummary?.id ?? 'workflow-1'
  const actorUserId = executionData.environment?.userId ?? 'actor-1'
  executionData = {
    ...executionData,
    environment: {
      workflowId,
      workspaceId,
      executionId,
      userId: actorUserId,
      ...executionData.environment,
    },
    billing: Object.hasOwn(executionData, 'billing')
      ? executionData.billing
      : {
          binding: {
            namespace: `billing-usage:user:${actorUserId}`,
            key: `invocation:${executionId}`,
            fingerprint: `accepted-fixture:${executionId}`,
            runId: executionId,
            workspaceId,
            workflowId,
            actorUserId,
            purpose: 'workflow-execution',
          },
        },
  }
  row = { ...row, workflowId, workflowSummary: row.workflowSummary ?? { id: workflowId } }
  if (executionData.finalOutput === undefined && executionData.traceSpans === undefined)
    return { ...row, id, workspaceId, executionId, executionData }
  const reference: NativePayloadRef = {
    version: 1,
    purpose: 'workflow-agent',
    workspaceId,
    executionId,
    logId: id,
    blockId: '__execution__',
    runId: 'fixture',
    resourceId: 'workflow-agent:fixture-resource',
    threadId: 'workflow-agent:fixture-thread',
    messageIds: ['fixture-message'],
    digest: 'fixture-native-reader',
  }
  payloads.set(reference, executionData)
  const { finalOutput: _output, traceSpans: _spans, ...control } = executionData
  return {
    ...row,
    id,
    workspaceId,
    executionId,
    executionData: {
      ...control,
      functionalPayload: reference,
      finalOutput: { version: 1, purpose: 'workflow-functional-output' },
    },
  }
}
export async function hydrateCanonicalLogFixture(row: any, authorize: () => Promise<void>) {
  await authorize()
  const sections = payloads.get(row.executionData?.functionalPayload)
  if (!sections) throw new Error('Test fixture has no verified canonical payload')
  await authorize()
  return { ...row, executionData: { ...row.executionData, ...sections } }
}
