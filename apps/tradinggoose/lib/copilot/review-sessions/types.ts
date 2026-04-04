export const ENTITY_KIND_WORKFLOW = 'workflow' as const
export const ENTITY_KIND_MCP_SERVER = 'mcp_server' as const
export const ENTITY_KIND_SKILL = 'skill' as const
export const ENTITY_KIND_CUSTOM_TOOL = 'custom_tool' as const
export const ENTITY_KIND_INDICATOR = 'indicator' as const

export const REVIEW_ENTITY_KINDS = [
  ENTITY_KIND_WORKFLOW,
  ENTITY_KIND_MCP_SERVER,
  ENTITY_KIND_SKILL,
  ENTITY_KIND_CUSTOM_TOOL,
  ENTITY_KIND_INDICATOR,
] as const

export type ReviewEntityKind = (typeof REVIEW_ENTITY_KINDS)[number]

export interface ReviewTargetDescriptor {
  workspaceId: string | null
  entityKind: ReviewEntityKind
  entityId: string | null
  draftSessionId: string | null
  reviewSessionId: string | null
  reviewModel: string | null
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

export const YJS_TARGET_KINDS = ['workflow', 'review_session'] as const

export type YjsTargetKind = (typeof YJS_TARGET_KINDS)[number]

export interface YjsTransportEnvelope {
  targetKind: YjsTargetKind
  sessionId: string
  workflowId: string | null
  reviewSessionId: string | null
  workspaceId: string | null
  entityKind: ReviewEntityKind
  entityId: string | null
  draftSessionId: string | null
  reviewModel: string | null
}
