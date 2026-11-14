import type { ChatContext } from '@/lib/copilot/chat-context-schema'
import type { CopilotToolContext } from '@/lib/copilot/native/contract'
import { DASHBOARD_LAYOUT_TOOL_NAMES, isToolId } from '@/lib/copilot/registry'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'
import { readCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'

export function collectCopilotToolContexts(contexts: ChatContext[]): CopilotToolContext[] {
  const result: CopilotToolContext[] = []
  for (const context of contexts) {
    const entity = readCopilotWorkspaceEntityContext(context)
    if (!entity?.entityId) continue
    const value: CopilotToolContext = {
      contextEntityKind: entity.entityKind,
      contextEntityId: entity.entityId,
      ...(entity.workspaceId ? { workspaceId: entity.workspaceId } : {}),
    }
    if (
      !result.some(
        (item) =>
          item.contextEntityKind === value.contextEntityKind &&
          item.contextEntityId === value.contextEntityId
      )
    )
      result.push(value)
  }
  return result
}

/** Select a target from persisted, authorized context; unrelated context never supplies its workspace. */
export function resolveCopilotToolContext(
  name: string,
  args: Record<string, unknown>,
  runContext?: CopilotToolContext,
  toolContexts: CopilotToolContext[] = []
): CopilotToolContext | undefined {
  const entityKind = isToolId(name) ? TOOL_PROMPT_METADATA[name].entityKind : undefined
  const entityId =
    typeof args.entityId === 'string' && args.entityId.trim() ? args.entityId.trim() : undefined
  const workspaceId =
    typeof args.workspaceId === 'string' && args.workspaceId.trim()
      ? args.workspaceId.trim()
      : undefined
  if (entityKind && entityId) {
    const exact =
      toolContexts.find(
        (context) =>
          context.contextEntityKind === entityKind && context.contextEntityId === entityId
      ) ??
      (runContext?.contextEntityKind === entityKind && runContext.contextEntityId === entityId
        ? runContext
        : undefined)
    return {
      ...exact,
      contextEntityKind: entityKind,
      contextEntityId: entityId,
      ...(workspaceId ? { workspaceId } : {}),
    }
  }
  if (DASHBOARD_LAYOUT_TOOL_NAMES.has(name)) {
    const dashboard =
      toolContexts.find((context) => context.contextEntityKind === 'dashboard_layout') ??
      (runContext?.contextEntityKind === 'dashboard_layout' ? runContext : undefined)
    if (dashboard) return { ...dashboard, ...(workspaceId ? { workspaceId } : {}) }
  }
  return workspaceId ? { ...runContext, workspaceId } : runContext
}
