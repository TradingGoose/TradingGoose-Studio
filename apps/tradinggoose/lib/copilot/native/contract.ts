import { z } from 'zod'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { MAX_COPILOT_CONTEXTS_PER_TURN } from '@/lib/copilot/context-limits'
import { REVIEW_ENTITY_KINDS } from '@/lib/copilot/review-sessions/types'
import type { NativeHistoryMessage } from '@/lib/mastra/messages'
import type { NativeUsage } from '@/lib/mastra/usage'

export type Json = null | boolean | number | string | Json[] | JsonObject
export interface JsonObject {
  [key: string]: Json
}
export interface Scope {
  actorUserId: string
  workspaceId: string | null
}
export const COPILOT_CONTEXT_PART = 'data-copilot-contexts' as const
const id = z.string().min(1)
export const TargetSchema = z
  .object({ threadId: id, resourceId: id, runId: id, toolCallId: id, toolName: id })
  .strict()
export const InputSchema = z
  .object({
    content: z.union([
      z.string(),
      z
        .array(
          z.union([
            z.object({ type: z.literal('text'), text: z.string() }).strict(),
            z.object({ type: z.literal('image'), image: id, mediaType: id }).strict(),
          ])
        )
        .min(1),
    ]),
    contexts: z.array(ChatContextSchema).max(MAX_COPILOT_CONTEXTS_PER_TURN).optional(),
    attachments: z.array(z.object({ name: z.string(), text: z.string() }).strict()).optional(),
  })
  .strict()
export const ToolContextSchema = z
  .object({
    contextEntityKind: z.enum(REVIEW_ENTITY_KINDS).optional(),
    contextEntityId: id.optional(),
    workspaceId: id.optional(),
  })
  .strict()
export type CopilotToolContext = z.infer<typeof ToolContextSchema>
export const BrowserAssertionSchema = z
  .object({
    kind: z.enum(['plan.updated', 'timer.completed', 'ui.opened']),
    data: z.json(),
  })
  .strict()
const base = { workspaceId: id.nullable() }

/** The authenticated Studio route validates this browser input once. */
export const CopilotRequestSchema = z.discriminatedUnion('command', [
  z
    .object({
      ...base,
      command: z.literal('message'),
      threadId: id.optional(),
      messageId: id.optional(),
      input: InputSchema,
      model: id,
      workflowId: id.optional(),
      accessLevel: z.enum(['limited', 'full']).optional(),
      toolContext: ToolContextSchema.optional(),
    })
    .strict(),
  z.object({ ...base, command: z.literal('tool.approve'), target: TargetSchema }).strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.decline'),
      target: TargetSchema,
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.execute'),
      target: TargetSchema,
      action: z.enum(['execute', 'review.accept', 'review.reject', 'readback']),
      context: ToolContextSchema.optional(),
      readback: z.object({ credentialId: id }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.result'),
      target: TargetSchema,
      assertion: BrowserAssertionSchema,
    })
    .strict(),
  z.object({ ...base, command: z.literal('cancel'), threadId: id, runId: id }).strict(),
  z.object({ ...base, command: z.literal('threads.list') }).strict(),
  z.object({ ...base, command: z.literal('thread.observe'), threadId: id }).strict(),
  z
    .object({ ...base, command: z.literal('thread.title'), threadId: id, title: z.string() })
    .strict(),
  z.object({ ...base, command: z.literal('thread.delete'), threadId: id }).strict(),
])

export type CopilotRequest = z.infer<typeof CopilotRequestSchema>
export type Target = z.infer<typeof TargetSchema>
export type CopilotToolTarget = { workspaceId: Scope['workspaceId']; target: Target }
export type Input = z.infer<typeof InputSchema>
export type ImagePart = Extract<Exclude<Input['content'], string>[number], { type: 'image' }>
export type BrowserAssertion = z.infer<typeof BrowserAssertionSchema>
export interface SafeError {
  code: string
  message: string
}
export interface Pending {
  target: Target
  stage: 'approval' | 'result'
  originalArgs: JsonObject
  context?: CopilotToolContext
  preview?: JsonObject
}
export interface ErrorResponse {
  status: 'refused' | 'failed'
  error: SafeError
  usage?: NativeUsage
}
export interface ReadyResponse {
  status: 'completed'
  runId: string
  threadId: string
  text: string
  usage?: NativeUsage
}
export interface SuspendedResponse {
  status: 'suspended'
  runId: string
  threadId: string
  text: string
  pending: Pending[]
  usage?: NativeUsage
}
export interface CancelResponse {
  status: 'cancel_requested'
  runId: string
}
export interface Thread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}
export interface ThreadsResponse {
  status: 'threads'
  items: Thread[]
}
export interface HistoryResponse {
  status: 'history'
  threadId: string
  items: NativeHistoryMessage[]
  pending: Pending[]
}
export interface MutationResponse {
  status: 'updated'
  threadId: string
  operation: 'thread.title' | 'thread.delete'
}
export type CopilotResponse =
  | ReadyResponse
  | SuspendedResponse
  | CancelResponse
  | ThreadsResponse
  | MutationResponse
  | ErrorResponse
export type CopilotOutputEvent =
  | { type: 'text.delta' | 'reasoning.delta'; text: string }
  | { type: 'tool.display'; toolCallId: string; toolName: string; args?: JsonObject }
  | {
      type: 'tool.result'
      toolCallId: string
      toolName: string
      result: Json
      isError?: boolean
      denied?: boolean
    }
export type CopilotThreadEvent =
  | { type: 'thread.started'; runId: string; messageId: string }
  | { type: 'thread.output'; runId: string; event: CopilotOutputEvent }
  | { type: 'thread.error'; runId: string; error: SafeError; history: HistoryResponse }
  | {
      type: 'thread.history'
      result: HistoryResponse
      activeRunId: string | null
      interruptedRunId?: string
    }
  | {
      type: 'thread.status'
      runId: string
      status: 'success' | 'failed' | 'aborted' | 'suspended'
      history: HistoryResponse
    }
export type CopilotEvent =
  | CopilotOutputEvent
  | { type: 'response.started'; runId: string; threadId: string; messageId?: string }
  | { type: 'response.completed'; result: ReadyResponse }
  | { type: 'response.suspended'; result: SuspendedResponse }
  | { type: 'response.refused' | 'response.error'; result: ErrorResponse }
  | { type: 'response.cancel_requested'; result: CancelResponse }
export interface UtilityMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}
export interface CompletionRequest {
  scope: Scope
  purpose: 'title' | 'wand'
  model: string
  messages: UtilityMessage[]
  maxOutputTokens?: number
}
export interface CompletionResponse {
  status: 'completed'
  runId: string
  text: string
  usage?: NativeUsage
}
export interface CompletionFailureResponse {
  status: 'refused' | 'failed' | 'cancel_requested'
  error: SafeError
  usage?: NativeUsage
}
export type CompletionEvent =
  | { chunk: string }
  | { done: true; result: CompletionResponse }
  | { error: string; code: string; refusal: boolean }
  | { cancelled: true }
