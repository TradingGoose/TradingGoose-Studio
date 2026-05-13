import type { ToolId } from '@/lib/copilot/registry'
import { verifyWorkflowAccess } from '@/lib/copilot/review-sessions/permissions'
import { normalizeOptionalString } from '@/lib/utils'

export interface ServerToolExecutionContext {
  userId: string
  contextWorkflowId?: string
}

export async function resolveServerWorkflowScope(
  params: { workflowId?: string } | undefined,
  context?: ServerToolExecutionContext
): Promise<{ workflowId: string; workspaceId?: string; hasAccess: boolean } | null> {
  const userId = normalizeOptionalString(context?.userId)
  const workflowId =
    normalizeOptionalString(params?.workflowId) ??
    normalizeOptionalString(context?.contextWorkflowId)

  if (!userId || !workflowId) {
    return null
  }

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
