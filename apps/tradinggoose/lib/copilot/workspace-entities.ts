import {
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_DASHBOARD_LAYOUT,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_KNOWLEDGE_BASE,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
  ENTITY_KIND_WATCHLIST,
  ENTITY_KIND_WORKFLOW,
} from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from '@/stores/copilot/types'

export const COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS = [
  ENTITY_KIND_WORKFLOW,
  ENTITY_KIND_SKILL,
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_WATCHLIST,
  ENTITY_KIND_DASHBOARD_LAYOUT,
  ENTITY_KIND_KNOWLEDGE_BASE,
] as const

export type CopilotWorkspaceEntityKind = (typeof COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS)[number]
type CopilotWorkspaceEntityContextDetails = {
  entityKind: CopilotWorkspaceEntityKind
  entityId: string | null
  workspaceId: string | null
  ownerUserId: string | null
  current: boolean
}

export function isCopilotWorkspaceEntityMentionOption(
  value: string
): value is CopilotWorkspaceEntityKind {
  return COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS.some((entityKind) => entityKind === value)
}

function getCopilotWorkspaceEntityKindFromContext(
  context: Pick<ChatContext, 'kind'> | null | undefined
): CopilotWorkspaceEntityKind | null {
  if (!context) {
    return null
  }

  const rawKind =
    context.kind === 'current_knowledge_base'
      ? ENTITY_KIND_KNOWLEDGE_BASE
      : context.kind === 'current_dashboard_layout'
        ? ENTITY_KIND_DASHBOARD_LAYOUT
        : context.kind

  return isCopilotWorkspaceEntityMentionOption(rawKind) ? rawKind : null
}

export function readCopilotWorkspaceEntityContext(
  context: ChatContext | null | undefined
): CopilotWorkspaceEntityContextDetails | null {
  const entityKind = getCopilotWorkspaceEntityKindFromContext(context)

  if (!context || !entityKind) {
    return null
  }

  return {
    entityKind,
    entityId: getCopilotWorkspaceEntityIdFromContext(context),
    workspaceId:
      'workspaceId' in context ? (normalizeOptionalString(context.workspaceId) ?? null) : null,
    ownerUserId:
      'ownerUserId' in context ? (normalizeOptionalString(context.ownerUserId) ?? null) : null,
    current: context.kind.startsWith('current_'),
  }
}

function getCopilotWorkspaceEntityIdFromContext(context: ChatContext): string | null {
  switch (context.kind) {
    case 'workflow':
      return normalizeOptionalString(context.workflowId) ?? null
    case 'skill':
      return normalizeOptionalString(context.skillId) ?? null
    case 'indicator':
      return normalizeOptionalString(context.indicatorId) ?? null
    case 'knowledge_base':
    case 'current_knowledge_base':
      return normalizeOptionalString(context.knowledgeBaseId) ?? null
    case 'custom_tool':
      return normalizeOptionalString(context.customToolId) ?? null
    case 'mcp_server':
      return normalizeOptionalString(context.mcpServerId) ?? null
    case 'watchlist':
      return normalizeOptionalString(context.watchlistId) ?? null
    case 'dashboard_layout':
    case 'current_dashboard_layout':
      return normalizeOptionalString(context.dashboardLayoutId) ?? null
    default:
      return null
  }
}

type BuildCopilotWorkspaceEntityContextOptions<K extends CopilotWorkspaceEntityKind> = {
  entityKind: K
  entityId: string
  ownerUserId?: string | null
  label: string
} & (K extends typeof ENTITY_KIND_KNOWLEDGE_BASE
  ? { workspaceId: string }
  : { workspaceId?: string | null })

export function buildCopilotWorkspaceEntityContext<K extends CopilotWorkspaceEntityKind>({
  entityKind,
  entityId,
  workspaceId,
  ownerUserId,
  label,
}: BuildCopilotWorkspaceEntityContextOptions<K>): ChatContext {
  const resolvedLabel = label.trim()
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)
  const normalizedOwnerUserId = normalizeOptionalString(ownerUserId)
  if (entityKind === ENTITY_KIND_KNOWLEDGE_BASE && !normalizedWorkspaceId) {
    throw new Error('Knowledge base context requires workspaceId')
  }
  if (entityKind === ENTITY_KIND_DASHBOARD_LAYOUT && !normalizedOwnerUserId) {
    throw new Error('Dashboard layout context requires ownerUserId')
  }
  const baseContext = {
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
    ...(entityKind === ENTITY_KIND_DASHBOARD_LAYOUT ? { ownerUserId: normalizedOwnerUserId } : {}),
    label: resolvedLabel,
  }

  switch (entityKind) {
    case ENTITY_KIND_WORKFLOW:
      return {
        kind: 'workflow',
        ...baseContext,
        workflowId: entityId,
      }
    case ENTITY_KIND_SKILL:
      return {
        kind: 'skill',
        ...baseContext,
        skillId: entityId,
      }
    case ENTITY_KIND_INDICATOR:
      return {
        kind: 'indicator',
        ...baseContext,
        indicatorId: entityId,
      }
    case ENTITY_KIND_KNOWLEDGE_BASE:
      return {
        kind: 'knowledge_base',
        knowledgeBaseId: entityId,
        workspaceId: normalizedWorkspaceId!,
        label: resolvedLabel,
      }
    case ENTITY_KIND_CUSTOM_TOOL:
      return {
        kind: 'custom_tool',
        ...baseContext,
        customToolId: entityId,
      }
    case ENTITY_KIND_MCP_SERVER:
      return {
        kind: 'mcp_server',
        ...baseContext,
        mcpServerId: entityId,
      }
    case ENTITY_KIND_WATCHLIST:
      return {
        kind: 'watchlist',
        ...baseContext,
        watchlistId: entityId,
      }
    case ENTITY_KIND_DASHBOARD_LAYOUT:
      return {
        kind: 'dashboard_layout',
        ...baseContext,
        dashboardLayoutId: entityId,
      }
  }
}
