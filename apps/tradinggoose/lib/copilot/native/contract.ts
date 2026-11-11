import { z } from 'zod'
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
    contexts: z.array(z.unknown()).optional(),
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
    kind: z.enum(['plan.updated', 'timer.completed', 'ui.opened', 'selection.submitted']),
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
      input: InputSchema,
      model: id,
      workflowId: id.optional(),
      accessLevel: z.enum(['limited', 'full']).optional(),
      toolContext: ToolContextSchema.optional(),
      toolContexts: z.array(ToolContextSchema).max(16).optional(),
    })
    .strict(),
  z.object({ ...base, command: z.literal('pending.list'), threadId: id }).strict(),
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
      accessLevel: z.enum(['limited', 'full']).optional(),
      context: ToolContextSchema.optional(),
      readback: z.object({ credentialId: id }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.result'),
      source: z.literal('browser_assertion'),
      target: TargetSchema,
      assertion: BrowserAssertionSchema,
    })
    .strict(),
  z.object({ ...base, command: z.literal('cancel'), threadId: id, runId: id }).strict(),
  z.object({ ...base, command: z.literal('threads.list') }).strict(),
  z.object({ ...base, command: z.literal('history.read'), threadId: id }).strict(),
  z
    .object({ ...base, command: z.literal('thread.title'), threadId: id, title: z.string() })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('history.edit'),
      threadId: id,
      messageId: id,
      text: z.string(),
    })
    .strict(),
  z.object({ ...base, command: z.literal('thread.delete'), threadId: id }).strict(),
])

export type CopilotRequest = z.infer<typeof CopilotRequestSchema>
export type Target = z.infer<typeof TargetSchema>
export type CopilotToolTarget = { workspaceId: Scope['workspaceId']; target: Target }
export type Input = z.infer<typeof InputSchema>
export type TextPart = Extract<Exclude<Input['content'], string>[number], { type: 'text' }>
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
}
export interface PendingResponse {
  status: 'pending_targets'
  items: Pending[]
}
export interface MutationResponse {
  status: 'updated'
  threadId: string
  operation: 'thread.title' | 'history.edit' | 'thread.delete'
  messageId?: string
}
export type CopilotResponse =
  | ReadyResponse
  | SuspendedResponse
  | PendingResponse
  | CancelResponse
  | ThreadsResponse
  | HistoryResponse
  | MutationResponse
  | ErrorResponse
export type CopilotEvent =
  | { type: 'response.started'; runId: string; threadId: string }
  | { type: 'text.delta' | 'reasoning.delta'; text: string }
  | { type: 'tool.display'; toolCallId: string; toolName: string; args?: JsonObject }
  | { type: 'tool.pending'; pending: Pending }
  | {
      type: 'tool.result'
      toolCallId: string
      toolName: string
      result: Json
      isError?: boolean
      denied?: boolean
    }
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
