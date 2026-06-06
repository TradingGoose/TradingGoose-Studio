import type { ToolId } from '@/lib/copilot/registry'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

export interface ServerToolExecutionContext {
  userId: string
  contextEntityKind?: ReviewEntityKind
  contextEntityId?: string
  workspaceId?: string
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

export interface BaseServerTool<TArgs = any, TResult = any> {
  name: ToolId
  execute(args: TArgs, context?: ServerToolExecutionContext): Promise<TResult>
}
