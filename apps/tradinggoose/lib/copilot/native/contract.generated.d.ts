/** Generated from accepted copilot-native/2026-11-09.8. Run generate:copilot-contract; do not edit. */

/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Json".
 */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [k: string]: Json
    }
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CopilotRequest".
 */
export type CopilotRequest =
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'message'
      threadId?: string
      input: Input
      model: string
      workflowId?: string
      toolManifest: ToolManifest
      systemPrompt?: string
      stream: boolean
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'pending.list'
      threadId: string
      page: Page
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'tool.approve'
      target: Target
      financialBinding: FinancialBinding
      stream: boolean
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'tool.decline'
      target: Target
      financialBinding: FinancialBinding
      reason?: string
      stream: boolean
    }
  | (
      | {
          protocolRevision: 'copilot-native/2026-11-09.8'
          requestId: string
          scope: Scope
          command: 'tool.result'
          source: 'studio_signed'
          target: Target
          financialBinding: FinancialBinding
          result: Json
          proof: string
          stream: boolean
        }
      | {
          protocolRevision: 'copilot-native/2026-11-09.8'
          requestId: string
          scope: Scope
          command: 'tool.result'
          source: 'browser_assertion'
          target: Target
          financialBinding: FinancialBinding
          assertion: BrowserAssertion
          stream: boolean
        }
    )
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'cancel'
      threadId: string
      runId: string
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'threads.list'
      page: Page
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'history.read'
      threadId: string
      page: Page
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'thread.title'
      threadId: string
      title: string
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'history.edit'
      threadId: string
      messageId: string
      text: string
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'thread.delete'
      threadId: string
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'context.read'
      threadId: string
    }
  | {
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      scope: Scope
      command: 'context.compact'
      threadId: string
      model: string
      stream: boolean
    }
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "SafeError".
 */
export type SafeError = {
  code:
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'INVALID_REQUEST'
    | 'INVALID_MODEL'
    | 'INVALID_RESULT'
    | 'STALE_TARGET'
    | 'ALREADY_CLAIMED'
    | 'ALREADY_ACCEPTED'
    | 'BUSY'
    | 'QUOTA_EXCEEDED'
    | 'NEEDS_QUIESCENCE'
    | 'DEPENDENCY_UNAVAILABLE'
    | 'NATIVE_FAILURE'
    | 'CANCEL_REQUESTED'
    | 'UNCERTAIN'
  message: string
  retryable: boolean
  uncertain: boolean
}
/**
 * Labelled scoped thread-size evidence only; no selected-model window, occupancy percentage or durable provider/monetary report. Current Studio model data has no capacity authority; contextUsage:null hides the percentage pill.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ContextResponse".
 */
export type ContextResponse = {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'context'
  threadId: string
  contextTokens: number | null
  tokenSource: 'active_native_usage' | 'context_estimate' | 'unavailable'
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CopilotResponse".
 */
export type CopilotResponse =
  | ReadyResponse
  | SuspendedResponse
  | PendingResponse
  | CancelResponse
  | ThreadsResponse
  | HistoryResponse
  | ContextResponse
  | MutationResponse
  | CompactResponse
  | ErrorResponse
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CopilotEvent".
 */
export type CopilotEvent =
  | {
      type: 'response.started'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      runId: string
      threadId: string
    }
  | {
      type: 'text.delta'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      text: string
    }
  | {
      type: 'reasoning.delta'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      text: string
    }
  | {
      type: 'tool.display'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      toolCallId: string
      toolName: string
      executionAuthorized: false
    }
  | {
      type: 'tool.pending'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      pending: Pending
      financial: FinancialFact
    }
  | {
      type: 'response.completed'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      result: ReadyResponse
    }
  | {
      type: 'response.suspended'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      result: SuspendedResponse
    }
  | {
      type: 'response.refused'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      result: ErrorResponse
    }
  | {
      type: 'response.error'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      result: ErrorResponse
    }
  | {
      type: 'response.cancel_requested'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      result: CancelResponse
    }
  | {
      type: 'context.compacted'
      protocolRevision: 'copilot-native/2026-11-09.8'
      requestId: string
      result: CompactResponse
    }
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CompletionEvent".
 */
export type CompletionEvent =
  | {
      chunk: string
    }
  | {
      done: true
      result: CompletionResponse
    }
  | {
      error: string
      code: string
      refusal: boolean
      uncertain: boolean
      financialDisposition: 'accepted' | 'not_contacted' | 'uncertain'
      financial?: FinancialFact
    }
  | {
      cancelled: true
      uncertain: boolean
      financialDisposition: 'accepted' | 'not_contacted' | 'uncertain'
      financial?: FinancialFact
    }

/**
 * Proposed .7 preserves canonical-string money and live chat images using an ordered JSON-safe subset of actual public AIV5 user content; mandatory encoding/source/native delivery/persistence gates, no native/runtime support or image-byte limit claim.
 */
export interface ProposedCopilotServiceTransportNotImplementedRuntimeVerified {
  [k: string]: unknown
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "JsonObject".
 */
export interface JsonObject {
  [k: string]: Json
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Scope".
 */
export interface Scope {
  actorUserId: string
  workspaceId: string | null
}
/**
 * Projection of actual @tradinggoose/billing@0.2.0-dev.2 public FinancialBinding returned by createInvocation from trusted authenticated scope/run. Namespace/key/fingerprint tie the original package receipt identity; payer/member/subscription/period/quote remain internal receipt identity, not extra binding or caller authority. Persist losslessly and recheck original binding before every contact. Source: ../public-financial-abi.json.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "FinancialBinding".
 */
export interface FinancialBinding {
  namespace: string
  key: string
  fingerprint: string
  runId: string
  actorUserId: string
  workspaceId: string | null
  workflowId: string | null
  purpose: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Target".
 */
export interface Target {
  threadId: string
  resourceId: string
  runId: string
  toolCallId: string
  toolName: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "SemanticValidator".
 */
export interface SemanticValidator {
  path: string
  kind: string
  args?: JsonObject
  description?: string
  message?: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Tool".
 */
export interface Tool {
  name: string
  description: string
  parameters: JsonObject
  arguments?: string
  semanticValidators?: SemanticValidator[]
  kind?: string
  entityKind?: string
  surfaceKind?: string
  approvalRequired: boolean
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ToolManifest".
 */
export interface ToolManifest {
  version: 'v1'
  tools: Tool[]
}
/**
 * String or ordered native text/image user content. Studio sends only positively authorized inline source content after whole batch/scope authorization before download. No second text field, raw provider fileAttachments or external fetch authority. Studio must refuse unproved generic aliases whose actual destination overlaps or cannot be proved separate from protected Copilot sources before signing/retrieval/model contact; no source locator or capability is added to this wire.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Input".
 */
export interface Input {
  contexts?: Json[]
  attachments?: {
    name: string
    text: string
  }[]
  /**
   * Pinned AIV5 user content subset; order is authoritative. Service fixes role=user; contexts/text attachments remain non-media inputs, never a hidden image lane.
   */
  content: string | [TextPart | ImagePart, ...(TextPart | ImagePart)[]]
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "TextPart".
 */
export interface TextPart {
  type: 'text'
  text: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ImagePart".
 */
export interface ImagePart {
  type: 'image'
  /**
   * Actual AIV5 ImagePart.image string, selected inline base64 data URL subset only. No remote URL, key, token or provider reference.
   */
  image: string
  /**
   * Actual AIV5 ImagePart.mediaType, explicit verified concrete image media type equal to data URL header; no app MIME/provider capability table.
   */
  mediaType: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Page".
 */
export interface Page {
  page: number
  perPage: number
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Usage".
 */
export interface Usage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}
/**
 * Verified accepted fact only. appliedUsd required even for exact zero; native modelUsd remains unavailable. Internal OperationReceipt amount remains optional in preaccepted/uncertain/unused states; no such internal receipt is a verified accepted FinancialFact.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "FinancialFact".
 */
export interface FinancialFact {
  accepted: true
  modelUsd: 'unavailable'
  /**
   * Required canonical DecimalAmount string from actual @tradinggoose/billing@0.2.0-dev.2 verifyAcceptance. typeof value===string and public /money monetary(value)===value, catching rejection. Missing/numeric/noncanonical/invalid accepted amount refuses; no fabricated zero/Number conversion/local regex/scale rule.
   */
  appliedUsd: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Pending".
 */
export interface Pending {
  target: Target
  stage: 'approval' | 'result'
  originalArgs: JsonObject
  financialBinding: FinancialBinding
  financialOccurrence: ModelOccurrence
}
/**
 * Projection of actual @tradinggoose/billing@0.2.0-dev.2 public ModelOccurrence: genuine native stepNumber/retryCount and optional runId validated against original FinancialBinding. Never default missing counters or accept result-caller overrides. These counters identify the admitted occurrence; they are not extra binding fields or caller financial authority. Source: ../public-financial-abi.json.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ModelOccurrence".
 */
export interface ModelOccurrence {
  stepNumber: number
  retryCount: number
  runId?: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "BrowserAssertion".
 */
export interface BrowserAssertion {
  kind: 'plan.updated' | 'timer.completed' | 'ui.opened' | 'selection.submitted'
  data: Json
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "UtilityMessage".
 */
export interface UtilityMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CompletionRequest".
 */
export interface CompletionRequest {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  scope: Scope
  purpose: 'title' | 'wand'
  model: string
  /**
   * @minItems 1
   */
  messages: [UtilityMessage, ...UtilityMessage[]]
  stream: boolean
  maxOutputTokens?: number
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ErrorResponse".
 */
export interface ErrorResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'refused' | 'failed'
  error: SafeError
  financial?: FinancialFact
  usage?: Usage
}
/**
 * Collected conversational success always returns its canonical native threadId, including a newly created first-message thread; never omit it because the caller did not supply a thread.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ReadyResponse".
 */
export interface ReadyResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'completed'
  runId: string
  threadId: string
  text: string
  usage?: Usage
  financial: FinancialFact
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "SuspendedResponse".
 */
export interface SuspendedResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'suspended'
  runId: string
  threadId: string
  text: string
  /**
   * @minItems 1
   */
  pending: [Pending, ...Pending[]]
  usage?: Usage
  financial: FinancialFact
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "PendingResponse".
 */
export interface PendingResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'pending_targets'
  items: Pending[]
  page: Page
  hasMore: boolean
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CancelResponse".
 */
export interface CancelResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'cancel_requested'
  runId: string
  acknowledged: boolean
  uncertaintyRemains: boolean
}
/**
 * Scoped canonical native thread projection. id is the native handle; title is thread.title ?? ''. Exactly '' denotes native untitled under selected creation/projection. Localized UI labels, New Chat/Untitled, whitespace or nonempty titles do not prove absence. No isUntitled/version/CAS field.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "Thread".
 */
export interface Thread {
  id: string
  /**
   * Canonical native title string, nullish native absence projected to ''. This is not a display fallback.
   */
  title: string
  createdAt: string
  updatedAt: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ThreadsResponse".
 */
export interface ThreadsResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'threads'
  items: Thread[]
  page: Page
  hasMore: boolean
}
/**
 * Scoped canonical native message projection. Retained image input is public native content.parts file {data:inline data URL,mimeType}; preserve original equivalent bytes/media/order and current history authorization independently of expired source tokens. No unsigned key/credential/private URL or placeholder delivery.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "HistoryMessage".
 */
export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'signal'
  createdAt: string
  parts: JsonObject[]
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "HistoryResponse".
 */
export interface HistoryResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'history'
  threadId: string
  items: HistoryMessage[]
  page: Page
  hasMore: boolean
}
/**
 * Confirms actual operation/thread identity. thread.title does not echo title; scoped paginated threads.list provides current native title readback, which may reflect a separate concurrent successful write. Never fabricate a mutation result or retry paid title work.
 *
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "MutationResponse".
 */
export interface MutationResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'updated'
  threadId: string
  operation: 'thread.title' | 'history.edit' | 'thread.delete'
  messageId?: string
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CompactResponse".
 */
export interface CompactResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'compacted'
  threadId: string
  applied: boolean
  sourceBoundaryVerified: true
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "CompletionResponse".
 */
export interface CompletionResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'completed'
  runId: string
  text: string
  financial: FinancialFact
  usage?: Usage
}
/**
 * This interface was referenced by `ProposedCopilotServiceTransportNotImplementedRuntimeVerified`'s JSON-Schema
 * via the `definition` "ProofClaims".
 */
export interface ProofClaims {
  type: 'copilot-tool-result'
  iss: 'tradinggoose-studio'
  aud: 'tradinggoose-copilot-result'
  iat: number
  exp: number
  actorId: string
  tenantId: string
  workspaceId: string | null
  resourceId: string
  threadId: string
  runId: string
  toolCallId: string
  toolName: string
  financialRootId: string
  argsDigest: string
  resultDigest: string
}
export interface CompletionFailureResponse {
  protocolRevision: 'copilot-native/2026-11-09.8'
  requestId: string
  status: 'refused' | 'failed' | 'cancel_requested'
  error: SafeError
  uncertain: boolean
  usage?: Usage
  financialDisposition: 'accepted' | 'not_contacted' | 'uncertain'
  financial?: FinancialFact
}

export interface NativeContractDefinitions {
  Json: Json
  JsonObject: JsonObject
  Scope: Scope
  FinancialBinding: FinancialBinding
  Target: Target
  SemanticValidator: SemanticValidator
  Tool: Tool
  ToolManifest: ToolManifest
  Input: Input
  Page: Page
  Usage: Usage
  FinancialFact: FinancialFact
  Pending: Pending
  BrowserAssertion: BrowserAssertion
  CopilotRequest: CopilotRequest
  UtilityMessage: UtilityMessage
  CompletionRequest: CompletionRequest
  SafeError: SafeError
  ErrorResponse: ErrorResponse
  ReadyResponse: ReadyResponse
  SuspendedResponse: SuspendedResponse
  PendingResponse: PendingResponse
  CancelResponse: CancelResponse
  Thread: Thread
  ThreadsResponse: ThreadsResponse
  HistoryMessage: HistoryMessage
  HistoryResponse: HistoryResponse
  ContextResponse: ContextResponse
  MutationResponse: MutationResponse
  CompactResponse: CompactResponse
  CopilotResponse: CopilotResponse
  CompletionResponse: CompletionResponse
  ProofClaims: ProofClaims
  CopilotEvent: CopilotEvent
  CompletionEvent: CompletionEvent
  ModelOccurrence: ModelOccurrence
  CompletionFailureResponse: CompletionFailureResponse
  ImagePart: ImagePart
  TextPart: TextPart
}
