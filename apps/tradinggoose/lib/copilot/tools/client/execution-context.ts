import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'

export function resolveWorkspaceIdFromExecutionContext(
  executionContext: ClientToolExecutionContext
): string {
  if (executionContext.workspaceId) {
    return executionContext.workspaceId
  }

  throw new Error(
    'No active workspace found in execution context. Ensure workspaceId is included in tool provenance.'
  )
}
