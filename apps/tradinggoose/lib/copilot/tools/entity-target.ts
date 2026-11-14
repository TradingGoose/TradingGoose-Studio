import { normalizeOptionalString } from '@/lib/utils'

export type CopilotEntityTargetArgs = {
  entityId?: string | null
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
