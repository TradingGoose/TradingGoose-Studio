import {
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_DASHBOARD_LAYOUT,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
  ENTITY_KIND_WATCHLIST,
  ENTITY_KIND_WORKFLOW,
  type ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from '@/stores/copilot/types'

type CopilotWorkspaceEntityConfig = {
  entityKind: ReviewEntityKind
  idField:
    | 'workflowId'
    | 'skillId'
    | 'indicatorId'
    | 'customToolId'
    | 'mcpServerId'
    | 'watchlistId'
    | 'dashboardLayoutId'
}

export const COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS = [
  {
    entityKind: ENTITY_KIND_WORKFLOW,
    idField: 'workflowId',
  },
  {
    entityKind: ENTITY_KIND_SKILL,
    idField: 'skillId',
  },
  {
    entityKind: ENTITY_KIND_CUSTOM_TOOL,
    idField: 'customToolId',
  },
  {
    entityKind: ENTITY_KIND_INDICATOR,
    idField: 'indicatorId',
  },
  {
    entityKind: ENTITY_KIND_MCP_SERVER,
    idField: 'mcpServerId',
  },
  {
    entityKind: ENTITY_KIND_WATCHLIST,
    idField: 'watchlistId',
  },
] as const satisfies readonly CopilotWorkspaceEntityConfig[]

export const COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS = [
  ...COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS,
  {
    entityKind: ENTITY_KIND_DASHBOARD_LAYOUT,
    idField: 'dashboardLayoutId',
  },
] as const satisfies readonly CopilotWorkspaceEntityConfig[]

export type CopilotWorkspaceEntityKind =
  (typeof COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS)[number]['entityKind']
export type CopilotEffectiveParamEntityKind =
  (typeof COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS)[number]['entityKind']
type CopilotWorkspaceEntityContextDetails = {
  entityKind: CopilotWorkspaceEntityKind
  entityId: string | null
  workspaceId: string | null
  ownerUserId: string | null
  current: boolean
}

const COPILOT_WORKSPACE_ENTITY_KIND_SET = new Set<string>(
  COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS.map((config) => config.entityKind)
)

const COPILOT_WORKSPACE_ENTITY_CONFIG_BY_KIND = new Map<
  CopilotWorkspaceEntityKind,
  (typeof COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS)[number]
>(COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS.map((config) => [config.entityKind, config]))

export const COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS =
  COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS.map(
    (config) => config.entityKind
  ) as CopilotWorkspaceEntityKind[]

export function getCopilotWorkspaceEntityConfig(
  entityKind: CopilotWorkspaceEntityKind
): (typeof COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS)[number] {
  const config = COPILOT_WORKSPACE_ENTITY_CONFIG_BY_KIND.get(entityKind)

  if (!config) {
    throw new Error(`Unknown copilot workspace entity kind: ${entityKind}`)
  }

  return config
}

export function isCopilotWorkspaceEntityMentionOption(
  value: string
): value is CopilotWorkspaceEntityKind {
  return COPILOT_WORKSPACE_ENTITY_KIND_SET.has(value)
}

export function getCopilotWorkspaceEntityKindFromContext(
  context: Pick<ChatContext, 'kind'> | null | undefined
): CopilotWorkspaceEntityKind | null {
  if (!context) {
    return null
  }

  const rawKind = context.kind.startsWith('current_')
    ? context.kind.slice('current_'.length)
    : context.kind

  return COPILOT_WORKSPACE_ENTITY_KIND_SET.has(rawKind)
    ? (rawKind as CopilotWorkspaceEntityKind)
    : null
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

export function getCopilotWorkspaceEntityIdFromContext(context: ChatContext): string | null {
  switch (context.kind) {
    case 'workflow':
    case 'current_workflow':
      return normalizeOptionalString(context.workflowId) ?? null
    case 'skill':
    case 'current_skill':
      return normalizeOptionalString(context.skillId) ?? null
    case 'indicator':
    case 'current_indicator':
      return normalizeOptionalString(context.indicatorId) ?? null
    case 'custom_tool':
    case 'current_custom_tool':
      return normalizeOptionalString(context.customToolId) ?? null
    case 'mcp_server':
    case 'current_mcp_server':
      return normalizeOptionalString(context.mcpServerId) ?? null
    case 'watchlist':
    case 'current_watchlist':
      return normalizeOptionalString(context.watchlistId) ?? null
    case 'dashboard_layout':
    case 'current_dashboard_layout':
      return normalizeOptionalString(context.dashboardLayoutId) ?? null
    default:
      return null
  }
}

export function getCopilotWorkspaceEntityIdFromEffectiveParams(
  effectiveParams: Record<string, unknown> | null | undefined,
  entityKind: CopilotEffectiveParamEntityKind
): string | null {
  if (!effectiveParams) {
    return null
  }

  switch (entityKind) {
    case ENTITY_KIND_WORKFLOW:
      return normalizeOptionalString(effectiveParams.workflowId) ?? null
    case ENTITY_KIND_SKILL:
      return normalizeOptionalString(effectiveParams.skillId) ?? null
    case ENTITY_KIND_INDICATOR:
      return normalizeOptionalString(effectiveParams.indicatorId) ?? null
    case ENTITY_KIND_CUSTOM_TOOL:
      return normalizeOptionalString(effectiveParams.customToolId) ?? null
    case ENTITY_KIND_MCP_SERVER:
      return normalizeOptionalString(effectiveParams.mcpServerId) ?? null
    case ENTITY_KIND_WATCHLIST:
      return normalizeOptionalString(effectiveParams.watchlistId) ?? null
  }
}

export function buildCopilotWorkspaceEntityContext({
  entityKind,
  entityId,
  workspaceId,
  ownerUserId,
  label,
  current = false,
}: {
  entityKind: CopilotWorkspaceEntityKind
  entityId: string
  workspaceId?: string | null
  ownerUserId?: string | null
  label: string
  current?: boolean
}): ChatContext {
  const config = getCopilotWorkspaceEntityConfig(entityKind)
  const resolvedLabel = label.trim()
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)
  const normalizedOwnerUserId = normalizeOptionalString(ownerUserId)
  if (entityKind === ENTITY_KIND_DASHBOARD_LAYOUT && !normalizedOwnerUserId) {
    throw new Error('Dashboard layout context requires ownerUserId')
  }
  const baseContext = {
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
    ...(entityKind === ENTITY_KIND_DASHBOARD_LAYOUT ? { ownerUserId: normalizedOwnerUserId } : {}),
    label: resolvedLabel,
  }

  switch (config.idField) {
    case 'workflowId':
      return {
        kind: current ? 'current_workflow' : 'workflow',
        ...baseContext,
        workflowId: entityId,
      }
    case 'skillId':
      return {
        kind: current ? 'current_skill' : 'skill',
        ...baseContext,
        skillId: entityId,
      }
    case 'indicatorId':
      return {
        kind: current ? 'current_indicator' : 'indicator',
        ...baseContext,
        indicatorId: entityId,
      }
    case 'customToolId':
      return {
        kind: current ? 'current_custom_tool' : 'custom_tool',
        ...baseContext,
        customToolId: entityId,
      }
    case 'mcpServerId':
      return {
        kind: current ? 'current_mcp_server' : 'mcp_server',
        ...baseContext,
        mcpServerId: entityId,
      }
    case 'watchlistId':
      return {
        kind: current ? 'current_watchlist' : 'watchlist',
        ...baseContext,
        watchlistId: entityId,
      }
    case 'dashboardLayoutId':
      return {
        kind: current ? 'current_dashboard_layout' : 'dashboard_layout',
        ...baseContext,
        dashboardLayoutId: entityId,
      }
  }
}

export function matchesCopilotWorkspaceEntityContext(
  context: ChatContext,
  entityKind: CopilotWorkspaceEntityKind,
  entityId: string
): boolean {
  return (
    getCopilotWorkspaceEntityKindFromContext(context) === entityKind &&
    getCopilotWorkspaceEntityIdFromContext(context) === entityId
  )
}
