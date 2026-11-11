import type { TraceSpan } from '@/lib/logs/types'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { isWorkflowBlockType } from '@/executor/consts'
import {
  type NativeHistoryMessage,
  type NativeMessageScope,
  projectNativeMessage,
} from './messages'

/** Callers authorize their product scope before reading its native conversation. */
export async function readNativeHistory(
  scope: NativeMessageScope,
  signal?: AbortSignal
): Promise<NativeHistoryMessage[]> {
  signal?.throwIfAborted()
  const { getNativeMemoryStore } = await import('./runtime')
  const result = await (await getNativeMemoryStore()).listMessages({
    ...scope,
    perPage: false,
    orderBy: { field: 'createdAt', direction: 'ASC' },
  })
  signal?.throwIfAborted()
  return result.messages.map(projectNativeMessage)
}

type ExecutionLog = {
  id: string
  workspaceId: string
  executionId: string | null
  workflowId: string | null
  executionData?: unknown
}

/** Attach the Agent's actual persisted turns only after authorizing their Studio execution. */
export async function attachAgentHistory<T extends ExecutionLog>(
  row: T,
  userId: string
): Promise<T> {
  const authorize = async () => {
    if (!(await checkWorkspaceAccess(row.workspaceId, userId)).hasAccess)
      throw new Error('Workflow execution access was revoked')
  }
  let readHistory = false
  const data = row.executionData as { traceSpans?: TraceSpan[] } | null
  if (!data?.traceSpans) return row
  const visit = async (span: TraceSpan): Promise<TraceSpan> => {
    // A child workflow owns its own execution log and native conversation scope.
    if (span.blockId && isWorkflowBlockType(span.type)) return span
    const history = span.inference?.history
    let agentHistory: NativeHistoryMessage[] | undefined
    let systemMessages: unknown
    if (history) {
      await authorize()
      readHistory = true
      if (!row.executionId) throw new Error('Agent history execution scope is missing')
      const { getNativeMemoryStore } = await import('./runtime')
      const store = await getNativeMemoryStore()
      const resourceId = `workflow-execution:${row.workspaceId}:${row.executionId}`
      if (
        history.resourceId !== resourceId ||
        history.threadId !== `workflow-agent:${history.runId}`
      )
        throw new Error('Agent history is outside the authorized execution')
      const thread = await store.getThreadById({ threadId: history.threadId, resourceId })
      const expected = {
        purpose: 'workflow-agent',
        workspaceId: row.workspaceId,
        executionId: row.executionId,
        logId: row.id,
        blockId: span.blockId,
        runId: history.runId,
        ...(row.workflowId ? { workflowId: row.workflowId } : {}),
      }
      if (
        !thread ||
        thread.resourceId !== resourceId ||
        Object.entries(expected).some(([key, value]) => thread.metadata?.[key] !== value)
      )
        throw new Error('Agent history owner does not match its execution')
      systemMessages = thread.metadata?.systemMessages
      agentHistory = await readNativeHistory({ threadId: history.threadId, resourceId })
    }
    return {
      ...span,
      ...(agentHistory ? { agentHistory } : {}),
      ...(systemMessages ? { input: { ...span.input, systemMessages } } : {}),
      ...(span.children ? { children: await Promise.all(span.children.map(visit)) } : {}),
    }
  }
  const traceSpans = await Promise.all(data.traceSpans.map(visit))
  if (readHistory) await authorize()
  return { ...row, executionData: { ...data, traceSpans } }
}

/** The caller supplies an execution log that its retention/delete operation actually removed. */
export async function deleteAgentHistory(
  row: Pick<ExecutionLog, 'id' | 'workspaceId' | 'executionId'>
): Promise<void> {
  if (!row.executionId) return
  const { getNativeMemoryStore } = await import('./runtime')
  const store = await getNativeMemoryStore()
  const resourceId = `workflow-execution:${row.workspaceId}:${row.executionId}`
  for (;;) {
    const result = await store.listThreads({
      page: 0,
      perPage: 100,
      filter: {
        resourceId,
        metadata: {
          purpose: 'workflow-agent',
          workspaceId: row.workspaceId,
          executionId: row.executionId,
          logId: row.id,
        },
      },
    })
    if (!result.threads.length) return
    for (const thread of result.threads) {
      if (
        thread.resourceId !== resourceId ||
        thread.metadata?.logId !== row.id ||
        thread.metadata?.workspaceId !== row.workspaceId
      )
        throw new Error('Agent history deletion scope mismatch')
      await store.deleteThread({ threadId: thread.id })
    }
  }
}
