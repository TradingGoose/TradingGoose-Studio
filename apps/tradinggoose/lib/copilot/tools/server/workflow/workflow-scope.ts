import { ENTITY_KIND_WORKFLOW } from '@/lib/copilot/review-sessions/types'
import {
  type CopilotEntityTargetArgs,
  resolveCopilotContextEntityId,
  resolveOptionalCopilotEntityId,
} from '@/lib/copilot/tools/entity-target'
import {
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { normalizeOptionalString } from '@/lib/utils'

export function createWorkflowPermissionError(operation: string): string {
  return `Access denied: You do not have permission to ${operation} this workflow`
}

export async function resolveServerWorkflowScope(
  params: CopilotEntityTargetArgs | undefined,
  context?: ServerToolExecutionContext
): Promise<{ workflowId: string; workspaceId?: string; hasAccess: boolean } | null> {
  throwIfServerToolAborted(context)

  const userId = normalizeOptionalString(context?.userId)
  const workflowId =
    resolveOptionalCopilotEntityId(params) ??
    resolveCopilotContextEntityId(context, ENTITY_KIND_WORKFLOW)

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
