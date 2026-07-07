export const ENTITY_KIND_WORKFLOW = 'workflow' as const
export const ENTITY_KIND_MCP_SERVER = 'mcp_server' as const
export const ENTITY_KIND_SKILL = 'skill' as const
export const ENTITY_KIND_CUSTOM_TOOL = 'custom_tool' as const
export const ENTITY_KIND_INDICATOR = 'indicator' as const
export const ENTITY_KIND_KNOWLEDGE_BASE = 'knowledge_base' as const
export const ENTITY_KIND_WATCHLIST = 'watchlist' as const
export const ENTITY_KIND_DASHBOARD_LAYOUT = 'dashboard_layout' as const

export const REVIEW_ENTITY_KINDS = [
  ENTITY_KIND_WORKFLOW,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_INDICATOR,
  ENTITY_KIND_KNOWLEDGE_BASE,
  ENTITY_KIND_WATCHLIST,
  ENTITY_KIND_DASHBOARD_LAYOUT,
] as const

export type ReviewEntityKind = (typeof REVIEW_ENTITY_KINDS)[number]
export type ReviewAccessMode = 'read' | 'write'

export interface ReviewTargetDescriptor {
  workspaceId: string | null
  ownerUserId: string | null
  entityKind: ReviewEntityKind
  entityId: string | null
  draftSessionId: string | null
  reviewSessionId: string | null
  yjsSessionId: string
}

export type ReviewTargetDocState = 'active' | 'expired'

export interface ReviewTargetRuntimeState {
  docState: ReviewTargetDocState
  replaySafe: boolean
  reseededFromCanonical: boolean
}

export interface ResolvedReviewTarget {
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}

export const YJS_TARGET_KINDS = ['entity', 'review_session', 'entity_list'] as const

export type YjsTargetKind = (typeof YJS_TARGET_KINDS)[number]

export interface YjsTransportEnvelope {
  targetKind: YjsTargetKind
  sessionId: string
  reviewSessionId: string | null
  workspaceId: string | null
  ownerUserId: string | null
  entityKind: ReviewEntityKind
  entityId: string | null
  draftSessionId: string | null
}
