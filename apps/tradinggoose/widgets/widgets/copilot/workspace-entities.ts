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
  defaultLabel: string
  currentLabel: string
  idField: 'workflowId' | 'skillId' | 'indicatorId' | 'customToolId' | 'mcpServerId'
}

export const COPILOT_WORKSPACE_ENTITY_CONFIGS = [
  {
    entityKind: ENTITY_KIND_WORKFLOW,
    defaultLabel: 'Workflow',
    currentLabel: 'Current Workflow',
    idField: 'workflowId',
  },
  {
    entityKind: ENTITY_KIND_SKILL,
    defaultLabel: 'Skill',
    currentLabel: 'Current Skill',
    idField: 'skillId',
  },
  {
    entityKind: ENTITY_KIND_CUSTOM_TOOL,
    defaultLabel: 'Custom Tool',
    currentLabel: 'Current Tool',
    idField: 'customToolId',
  },
  {
    entityKind: ENTITY_KIND_INDICATOR,
    defaultLabel: 'Indicator',
    currentLabel: 'Current Indicator',
    idField: 'indicatorId',
  },
  {
    entityKind: ENTITY_KIND_MCP_SERVER,
    defaultLabel: 'MCP Server',
    currentLabel: 'Current MCP Server',
    idField: 'mcpServerId',
  },
] as const satisfies readonly CopilotWorkspaceEntityConfig[]

export type CopilotWorkspaceEntityKind =
  (typeof COPILOT_WORKSPACE_ENTITY_CONFIGS)[number]['entityKind']
export type CopilotWorkspaceEntityMentionOption = CopilotWorkspaceEntityKind
type CopilotWorkspaceEntityContextDetails = {
  entityKind: CopilotWorkspaceEntityKind
  entityId: string | null
  workspaceId: string | null
  current: boolean
}

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
    config.entityKind as CopilotWorkspaceEntityMentionOption,
    config,
  ])
)

export const COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS = COPILOT_WORKSPACE_ENTITY_CONFIGS.map(
  (config) => config.entityKind
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
  const resolvedLabel = label?.trim() || (current ? config.currentLabel : config.defaultLabel)
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId)
  const baseContext = {
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
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
