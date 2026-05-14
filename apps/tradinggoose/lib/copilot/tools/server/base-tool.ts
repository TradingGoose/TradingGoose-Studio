import type { ToolId } from '@/lib/copilot/registry'
import { normalizeOptionalString } from '@/lib/utils'

export interface ServerToolExecutionContext {
  userId: string
  contextWorkflowId?: string
  signal?: AbortSignal
}

export function throwIfServerToolAborted(context?: ServerToolExecutionContext): void {
  if (!context?.signal?.aborted) {
    return
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

export function createPermissionError(operation: string): string {
  return `Access denied: You do not have permission to ${operation} this workflow`
}

export async function resolveServerWorkflowScope(
  params: { workflowId?: string } | undefined,
  context?: ServerToolExecutionContext
): Promise<{ workflowId: string; workspaceId?: string; hasAccess: boolean } | null> {
  throwIfServerToolAborted(context)

  const userId = normalizeOptionalString(context?.userId)
  const workflowId =
    normalizeOptionalString(params?.workflowId) ??
    normalizeOptionalString(context?.contextWorkflowId)

  if (!userId || !workflowId) {
    return null
  }

  const { verifyWorkflowAccess } = await import('@/lib/copilot/review-sessions/permissions')
  const access = await verifyWorkflowAccess(userId, workflowId, 'read')

  return {
    workflowId,
    workspaceId: access.workspaceId ?? undefined,
    hasAccess: access.hasAccess,
  }
}

export interface BaseServerTool<TArgs = any, TResult = any> {
  name: ToolId
  execute(args: TArgs, context?: ServerToolExecutionContext): Promise<TResult>
}
