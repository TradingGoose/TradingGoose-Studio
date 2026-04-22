import {
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
  ENTITY_KIND_WORKFLOW,
  type ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type { ChatContext } from '@/stores/copilot/types'
import type { PairColorContext } from '@/stores/dashboard/pair-store'

type CopilotWorkspaceEntityConfig = {
  entityKind: ReviewEntityKind
  mentionOption: string
  submenuTitle: string
  currentKind: ChatContext['kind']
  currentLabel: string
}

export const COPILOT_WORKSPACE_ENTITY_CONFIGS = [
  {
    entityKind: ENTITY_KIND_WORKFLOW,
    mentionOption: 'Workflows',
    submenuTitle: 'All workflows',
    currentKind: 'current_workflow',
    currentLabel: 'Current Workflow',
  },
  {
    entityKind: ENTITY_KIND_SKILL,
    mentionOption: 'Skills',
    submenuTitle: 'Skills',
    currentKind: 'current_skill',
    currentLabel: 'Current Skill',
  },
  {
    entityKind: ENTITY_KIND_CUSTOM_TOOL,
    mentionOption: 'Custom Tools',
    submenuTitle: 'Custom Tools',
    currentKind: 'current_custom_tool',
    currentLabel: 'Current Tool',
  },
  {
    entityKind: ENTITY_KIND_INDICATOR,
    mentionOption: 'Indicators',
    submenuTitle: 'Indicators',
    currentKind: 'current_indicator',
    currentLabel: 'Current Indicator',
  },
  {
    entityKind: ENTITY_KIND_MCP_SERVER,
    mentionOption: 'MCP Servers',
    submenuTitle: 'MCP Servers',
    currentKind: 'current_mcp_server',
    currentLabel: 'Current MCP Server',
  },
] as const satisfies readonly CopilotWorkspaceEntityConfig[]

export type CopilotWorkspaceEntityKind =
  (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number]['entityKind']
export type CopilotWorkspaceEntityMentionOption =
  (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number]['mentionOption']

const COPILOT_WORKSPACE_ENTITY_KIND_SET = new Set<string>(
  COPILOT_WORKSPACE_ENTITY_CONFIGS.map((config) => config.entityKind)
)

const COPILOT_WORKSPACE_ENTITY_CONFIG_BY_KIND = new Map<
  CopilotWorkspaceEntityKind,
  (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number]
>(COPILOT_WORKSPACE_ENTITY_CONFIGS.map((config) => [config.entityKind, config]))

const COPILOT_WORKSPACE_ENTITY_CONFIG_BY_MENTION_OPTION = new Map<
  CopilotWorkspaceEntityMentionOption,
  (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number]
>(
  COPILOT_WORKSPACE_ENTITY_CONFIGS.map((config) => [
    config.mentionOption as CopilotWorkspaceEntityMentionOption,
    config,
  ])
)

export const COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS = COPILOT_WORKSPACE_ENTITY_CONFIGS.map(
  (config) => config.mentionOption
) as CopilotWorkspaceEntityMentionOption[]

export function getCopilotWorkspaceEntityConfig(
  entityKind: CopilotWorkspaceEntityKind
): (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number] {
  const config = COPILOT_WORKSPACE_ENTITY_CONFIG_BY_KIND.get(entityKind)

  if (!config) {
    throw new Error(`Unknown copilot workspace entity kind: ${entityKind}`)
  }

  return config
}

export function getCopilotWorkspaceEntityConfigForMentionOption(
  mentionOption: CopilotWorkspaceEntityMentionOption
): (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number] {
  const config = COPILOT_WORKSPACE_ENTITY_CONFIG_BY_MENTION_OPTION.get(mentionOption)

  if (!config) {
    throw new Error(`Unknown copilot workspace entity mention option: ${mentionOption}`)
  }

  return config
}

export function isCopilotWorkspaceEntityMentionOption(
  value: string
): value is CopilotWorkspaceEntityMentionOption {
  return COPILOT_WORKSPACE_ENTITY_CONFIG_BY_MENTION_OPTION.has(
    value as CopilotWorkspaceEntityMentionOption
  )
}

export function getCopilotWorkspaceEntityKindFromMentionOption(
  mentionOption: CopilotWorkspaceEntityMentionOption
): CopilotWorkspaceEntityKind {
  return getCopilotWorkspaceEntityConfigForMentionOption(mentionOption).entityKind
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
    default:
      return null
  }
}

export function getCopilotWorkspaceEntityIdFromPairContext(
  pairContext: PairColorContext | null | undefined,
  entityKind: CopilotWorkspaceEntityKind
): string | null {
  if (!pairContext) {
    return null
  }

  switch (entityKind) {
    case ENTITY_KIND_WORKFLOW:
      return normalizeOptionalString(pairContext.workflowId) ?? null
    case ENTITY_KIND_SKILL:
      return normalizeOptionalString(pairContext.skillId) ?? null
    case ENTITY_KIND_INDICATOR:
      return normalizeOptionalString(pairContext.indicatorId) ?? null
    case ENTITY_KIND_CUSTOM_TOOL:
      return normalizeOptionalString(pairContext.customToolId) ?? null
    case ENTITY_KIND_MCP_SERVER:
      return normalizeOptionalString(pairContext.mcpServerId) ?? null
  }
}

export function buildCopilotWorkspaceEntityContext({
  entityKind,
  entityId,
  workspaceId,
  label,
  current = false,
}: {
  entityKind: CopilotWorkspaceEntityKind
  entityId: string
  workspaceId?: string | null
  label?: string
  current?: boolean
}): ChatContext {
  const config = getCopilotWorkspaceEntityConfig(entityKind)
  const resolvedLabel = label?.trim() || (current ? config.currentLabel : config.mentionOption)
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)

  if (entityKind === ENTITY_KIND_WORKFLOW) {
    return {
      kind: current ? 'current_workflow' : 'workflow',
      workflowId: entityId,
      label: resolvedLabel,
    }
  }

  if (entityKind === ENTITY_KIND_SKILL) {
    return {
      kind: current ? 'current_skill' : 'skill',
      skillId: entityId,
      ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
      label: resolvedLabel,
    }
  }

  if (entityKind === ENTITY_KIND_INDICATOR) {
    return {
      kind: current ? 'current_indicator' : 'indicator',
      indicatorId: entityId,
      ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
      label: resolvedLabel,
    }
  }

  if (entityKind === ENTITY_KIND_CUSTOM_TOOL) {
    return {
      kind: current ? 'current_custom_tool' : 'custom_tool',
      customToolId: entityId,
      ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
      label: resolvedLabel,
    }
  }

  return {
    kind: current ? 'current_mcp_server' : 'mcp_server',
    mcpServerId: entityId,
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
    label: resolvedLabel,
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
