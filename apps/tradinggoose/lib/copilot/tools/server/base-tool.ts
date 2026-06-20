import {
  type CopilotAccessLevel,
  shouldRequireToolApproval,
} from '@/lib/copilot/access-policy'
import type { ToolId } from '@/lib/copilot/registry'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

export interface ServerToolExecutionContext {
  userId: string
  accessLevel?: CopilotAccessLevel
  contextEntityKind?: ReviewEntityKind
  contextEntityId?: string
  workspaceId?: string
  signal?: AbortSignal
}

export type WorkspaceArg = {
  workspaceId?: unknown
}

function normalizeWorkspaceArg(args?: WorkspaceArg): string | undefined {
  return typeof args?.workspaceId === 'string' && args.workspaceId.trim().length > 0
    ? args.workspaceId.trim()
    : undefined
}

export function withWorkspaceArgContext<TArgs extends WorkspaceArg>(
  context: ServerToolExecutionContext | undefined,
  args: TArgs | undefined
): ServerToolExecutionContext | undefined {
  const argWorkspaceId = normalizeWorkspaceArg(args)
  if (!argWorkspaceId) {
    return context
  }

  const contextWorkspaceId = context?.workspaceId?.trim()
  if (contextWorkspaceId && contextWorkspaceId !== argWorkspaceId) {
    throw new Error('workspaceId does not match execution context')
  }

  return {
    ...(context ?? ({} as ServerToolExecutionContext)),
    workspaceId: argWorkspaceId,
  }
}

export function throwIfServerToolAborted(context?: ServerToolExecutionContext): void {
  if (!context?.signal?.aborted) {
    return
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

export function shouldStageServerToolMutationForReview(
  context?: ServerToolExecutionContext
): boolean {
  if (!context?.accessLevel) {
    throw new Error('Copilot accessLevel is required to execute mutation tools')
  }

  return shouldRequireToolApproval(context.accessLevel, true)
}

export interface BaseServerTool<TArgs = any, TResult = any> {
  name: ToolId
  execute(args: TArgs, context?: ServerToolExecutionContext): Promise<TResult>
}
