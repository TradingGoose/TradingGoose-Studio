import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'

export type CopilotEntityTargetArgs = {
  entityId?: string | null
}

export type CopilotEntityExecutionContext = {
  contextEntityKind?: ReviewEntityKind | null
  contextEntityId?: string | null
}

export function resolveOptionalCopilotEntityId(
  args: CopilotEntityTargetArgs | null | undefined
): string | undefined {
  return normalizeOptionalString(args?.entityId)
}

export function requireCopilotEntityId(
  args: CopilotEntityTargetArgs | null | undefined,
  options?: { toolName?: string }
): string {
  const entityId = resolveOptionalCopilotEntityId(args)
  if (entityId) {
    return entityId
  }

  throw new Error(
    options?.toolName ? `entityId is required for ${options.toolName}` : 'entityId is required'
  )
}

export function resolveCopilotContextEntityId(
  context: CopilotEntityExecutionContext | null | undefined,
  entityKind: ReviewEntityKind
): string | undefined {
  if (context?.contextEntityKind !== entityKind) {
    return undefined
  }

  return normalizeOptionalString(context.contextEntityId)
}
