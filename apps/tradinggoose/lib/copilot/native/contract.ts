import { monetary } from '@tradinggoose/billing/money'
import { z } from 'zod'
import { REVIEW_ENTITY_KINDS } from '@/lib/copilot/review-sessions/types'

export type Json = null | boolean | number | string | Json[] | JsonObject
export interface JsonObject {
  [key: string]: Json
}
const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ])
)
const JsonObjectSchema = z.record(z.string(), JsonSchema)
const id = z.string().min(1)
const ScopeSchema = z.object({ actorUserId: id, workspaceId: id.nullable() }).strict()
const TargetSchema = z
  .object({ threadId: id, resourceId: id, runId: id, toolCallId: id, toolName: id })
  .strict()
const FinancialFactSchema = z
  .object({
    accepted: z.literal(true),
    modelUsd: z.literal('unavailable'),
    appliedUsd: z.string().refine((value) => {
      try {
        return monetary(value) === value
      } catch {
        return false
      }
    }, 'Invalid monetary amount'),
  })
  .strict()
const UsageSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .strict()
const PageSchema = z
  .object({ page: z.number().int().nonnegative(), perPage: z.number().int().min(1).max(100) })
  .strict()
const TextPartSchema = z.object({ type: z.literal('text'), text: z.string() }).strict()
const ImagePartSchema = z.object({ type: z.literal('image'), image: id, mediaType: id }).strict()
const InputSchema = z
  .object({
    content: z.union([z.string(), z.array(z.union([TextPartSchema, ImagePartSchema])).min(1)]),
    contexts: z.array(JsonSchema).optional(),
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
const AccessLevelSchema = z.enum(['limited', 'full'])
export type CopilotToolContext = z.infer<typeof ToolContextSchema>
const BrowserAssertionSchema = z
  .object({
    kind: z.enum(['plan.updated', 'timer.completed', 'ui.opened', 'selection.submitted']),
    data: JsonSchema,
  })
  .strict()
const PendingSchema = z
  .object({
    target: TargetSchema,
    stage: z.enum(['approval', 'result']),
    originalArgs: JsonObjectSchema,
    preview: JsonObjectSchema.optional(),
  })
  .strict()
const base = { requestId: id, scope: ScopeSchema }
export const CopilotRequestSchema = z.discriminatedUnion('command', [
  z
    .object({
      ...base,
      command: z.literal('message'),
      threadId: id.optional(),
      input: InputSchema,
      model: id,
      workflowId: id.optional(),
      accessLevel: AccessLevelSchema.optional(),
      toolContext: ToolContextSchema.optional(),
      toolContexts: z.array(ToolContextSchema).max(16).optional(),
      stream: z.boolean(),
    })
    .strict(),
  z
    .object({ ...base, command: z.literal('pending.list'), threadId: id, page: PageSchema })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.approve'),
      target: TargetSchema,
      stream: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.decline'),
      target: TargetSchema,
      reason: z.string().optional(),
      stream: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.execute'),
      target: TargetSchema,
      action: z.enum(['execute', 'review.accept', 'review.reject', 'readback']),
      reviewToken: id.optional(),
      accessLevel: AccessLevelSchema.optional(),
      context: ToolContextSchema.optional(),
      readback: z.object({ credentialId: id }).strict().optional(),
      stream: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      command: z.literal('tool.result'),
      source: z.literal('browser_assertion'),
      target: TargetSchema,
      assertion: BrowserAssertionSchema,
      stream: z.boolean(),
    })
    .strict(),
  z.object({ ...base, command: z.literal('cancel'), threadId: id, runId: id }).strict(),
  z.object({ ...base, command: z.literal('threads.list'), page: PageSchema }).strict(),
  z
    .object({ ...base, command: z.literal('history.read'), threadId: id, page: PageSchema })
    .strict(),
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
  z.object({ ...base, command: z.literal('context.read'), threadId: id }).strict(),
  z
    .object({
      ...base,
      command: z.literal('context.compact'),
      threadId: id,
      model: id,
      stream: z.boolean(),
    })
    .strict(),
])
const SafeErrorSchema = z
  .object({ code: z.string(), message: z.string(), retryable: z.boolean(), uncertain: z.boolean() })
  .strict()
const responseBase = { requestId: id }
const facts = { usage: UsageSchema.optional(), financial: FinancialFactSchema }
const ErrorResponseSchema = z
  .object({
    ...responseBase,
    status: z.enum(['refused', 'failed']),
    error: SafeErrorSchema,
    financial: FinancialFactSchema.optional(),
    usage: UsageSchema.optional(),
  })
  .strict()
const ReadyResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('completed'),
    runId: id,
    threadId: id,
    text: z.string(),
    ...facts,
  })
  .strict()
const SuspendedResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('suspended'),
    runId: id,
    threadId: id,
    text: z.string(),
    pending: z.array(PendingSchema).min(1),
    ...facts,
  })
  .strict()
const PendingResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('pending_targets'),
    items: z.array(PendingSchema),
    page: PageSchema,
    hasMore: z.boolean(),
  })
  .strict()
const CancelResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('cancel_requested'),
    runId: id,
    acknowledged: z.boolean(),
    uncertaintyRemains: z.boolean(),
  })
  .strict()
const ThreadSchema = z
  .object({ id, title: z.string(), createdAt: z.string(), updatedAt: z.string() })
  .strict()
const ThreadsResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('threads'),
    items: z.array(ThreadSchema),
    page: PageSchema,
    hasMore: z.boolean(),
  })
  .strict()
const HistoryMessageSchema = z
  .object({
    id,
    role: z.enum(['user', 'assistant', 'system', 'signal']),
    createdAt: z.string(),
    parts: z.array(JsonObjectSchema),
  })
  .strict()
const HistoryResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('history'),
    threadId: id,
    items: z.array(HistoryMessageSchema),
    page: PageSchema,
    hasMore: z.boolean(),
  })
  .strict()
const ContextResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('context'),
    threadId: id,
    contextTokens: z.number().nullable(),
    tokenSource: z.enum(['active_native_usage', 'context_estimate', 'unavailable']),
  })
  .strict()
const MutationResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('updated'),
    threadId: id,
    operation: z.enum(['thread.title', 'history.edit', 'thread.delete']),
    messageId: id.optional(),
  })
  .strict()
const CompactResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('compacted'),
    threadId: id,
    applied: z.boolean(),
    sourceBoundaryVerified: z.literal(true),
  })
  .strict()
const CopilotResponseSchema = z.union([
  ReadyResponseSchema,
  SuspendedResponseSchema,
  PendingResponseSchema,
  CancelResponseSchema,
  ThreadsResponseSchema,
  HistoryResponseSchema,
  ContextResponseSchema,
  MutationResponseSchema,
  CompactResponseSchema,
  ErrorResponseSchema,
])
const UtilityMessageSchema = z
  .object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string() })
  .strict()
const CompletionRequestSchema = z
  .object({
    ...base,
    purpose: z.enum(['title', 'wand']),
    model: id,
    messages: z.array(UtilityMessageSchema).min(1),
    stream: z.boolean(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict()
const CompletionResponseSchema = z
  .object({
    ...responseBase,
    status: z.literal('completed'),
    runId: id,
    text: z.string(),
    ...facts,
  })
  .strict()
const CompletionFailureResponseSchema = z
  .object({
    ...responseBase,
    status: z.enum(['refused', 'failed', 'cancel_requested']),
    error: SafeErrorSchema,
    uncertain: z.boolean(),
    financialDisposition: z.enum(['accepted', 'not_contacted', 'uncertain']),
    usage: UsageSchema.optional(),
    financial: FinancialFactSchema.optional(),
  })
  .strict()
const CopilotEventSchema = z.discriminatedUnion('type', [
  z
    .object({ ...responseBase, type: z.literal('response.started'), runId: id, threadId: id })
    .strict(),
  z.object({ ...responseBase, type: z.literal('text.delta'), text: z.string() }).strict(),
  z.object({ ...responseBase, type: z.literal('reasoning.delta'), text: z.string() }).strict(),
  z
    .object({
      ...responseBase,
      type: z.literal('tool.display'),
      toolCallId: id,
      toolName: id,
      executionAuthorized: z.literal(false),
      args: JsonObjectSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...responseBase,
      type: z.literal('tool.pending'),
      pending: PendingSchema,
      financial: FinancialFactSchema,
    })
    .strict(),
  z
    .object({
      ...responseBase,
      type: z.literal('tool.result'),
      toolCallId: id,
      toolName: id,
      result: JsonSchema,
      isError: z.boolean().optional(),
      denied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ ...responseBase, type: z.literal('response.completed'), result: ReadyResponseSchema })
    .strict(),
  z
    .object({
      ...responseBase,
      type: z.literal('response.suspended'),
      result: SuspendedResponseSchema,
    })
    .strict(),
  z
    .object({ ...responseBase, type: z.literal('response.refused'), result: ErrorResponseSchema })
    .strict(),
  z
    .object({ ...responseBase, type: z.literal('response.error'), result: ErrorResponseSchema })
    .strict(),
  z
    .object({
      ...responseBase,
      type: z.literal('response.cancel_requested'),
      result: CancelResponseSchema,
    })
    .strict(),
  z
    .object({
      ...responseBase,
      type: z.literal('context.compacted'),
      result: CompactResponseSchema,
    })
    .strict(),
])
const completionFailureFacts = {
  uncertain: z.boolean(),
  financialDisposition: z.enum(['accepted', 'not_contacted', 'uncertain']),
  financial: FinancialFactSchema.optional(),
}
const CompletionEventSchema = z.union([
  z.object({ chunk: z.string() }).strict(),
  z.object({ done: z.literal(true), result: CompletionResponseSchema }).strict(),
  z
    .object({
      error: z.string(),
      code: z.string(),
      refusal: z.boolean(),
      ...completionFailureFacts,
    })
    .strict(),
  z.object({ cancelled: z.literal(true), ...completionFailureFacts }).strict(),
])
const definitions = {
  Json: JsonSchema,
  JsonObject: JsonObjectSchema,
  Scope: ScopeSchema,
  Target: TargetSchema,
  FinancialFact: FinancialFactSchema,
  Usage: UsageSchema,
  Page: PageSchema,
  TextPart: TextPartSchema,
  ImagePart: ImagePartSchema,
  Input: InputSchema,
  BrowserAssertion: BrowserAssertionSchema,
  Pending: PendingSchema,
  CopilotRequest: CopilotRequestSchema,
  SafeError: SafeErrorSchema,
  ErrorResponse: ErrorResponseSchema,
  ReadyResponse: ReadyResponseSchema,
  SuspendedResponse: SuspendedResponseSchema,
  PendingResponse: PendingResponseSchema,
  CancelResponse: CancelResponseSchema,
  Thread: ThreadSchema,
  ThreadsResponse: ThreadsResponseSchema,
  HistoryMessage: HistoryMessageSchema,
  HistoryResponse: HistoryResponseSchema,
  ContextResponse: ContextResponseSchema,
  MutationResponse: MutationResponseSchema,
  CompactResponse: CompactResponseSchema,
  CopilotResponse: CopilotResponseSchema,
  UtilityMessage: UtilityMessageSchema,
  CompletionRequest: CompletionRequestSchema,
  CompletionResponse: CompletionResponseSchema,
  CompletionFailureResponse: CompletionFailureResponseSchema,
  CopilotEvent: CopilotEventSchema,
  CompletionEvent: CompletionEventSchema,
}
export type NativeContractDefinitions = {
  [K in keyof typeof definitions]: z.infer<(typeof definitions)[K]>
}
export type Scope = z.infer<typeof ScopeSchema>
export type Target = z.infer<typeof TargetSchema>
export type FinancialFact = z.infer<typeof FinancialFactSchema>
export type Usage = z.infer<typeof UsageSchema>
export type Page = z.infer<typeof PageSchema>
export type TextPart = z.infer<typeof TextPartSchema>
export type ImagePart = z.infer<typeof ImagePartSchema>
export type Input = z.infer<typeof InputSchema>
export type BrowserAssertion = z.infer<typeof BrowserAssertionSchema>
export type Pending = z.infer<typeof PendingSchema>
export type CopilotRequest = z.infer<typeof CopilotRequestSchema>
export type SafeError = z.infer<typeof SafeErrorSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>
export type SuspendedResponse = z.infer<typeof SuspendedResponseSchema>
export type PendingResponse = z.infer<typeof PendingResponseSchema>
export type CancelResponse = z.infer<typeof CancelResponseSchema>
export type Thread = z.infer<typeof ThreadSchema>
export type ThreadsResponse = z.infer<typeof ThreadsResponseSchema>
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>
export type ContextResponse = z.infer<typeof ContextResponseSchema>
export type MutationResponse = z.infer<typeof MutationResponseSchema>
export type CompactResponse = z.infer<typeof CompactResponseSchema>
export type CopilotResponse = z.infer<typeof CopilotResponseSchema>
export type UtilityMessage = z.infer<typeof UtilityMessageSchema>
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>
export type CompletionFailureResponse = z.infer<typeof CompletionFailureResponseSchema>
export type CopilotEvent = z.infer<typeof CopilotEventSchema>
export type CompletionEvent = z.infer<typeof CompletionEventSchema>

export function isNativeContractDefinition(name: string): name is keyof NativeContractDefinitions {
  return Object.hasOwn(definitions, name)
}
export async function parseNativeContract<K extends keyof NativeContractDefinitions>(
  name: K,
  value: unknown
): Promise<NativeContractDefinitions[K]> {
  return definitions[name].parse(value) as NativeContractDefinitions[K]
}
export function assertNativeCorrelation(value: { requestId: string }, requestId: string) {
  if (value.requestId !== requestId) throw new Error('Copilot response does not match the request')
}
export class NativeCommandResponseError extends Error {
  readonly nativeOutcome: ErrorResponse
  constructor(value: CopilotResponse) {
    super('Copilot response does not match the requested command')
    this.name = 'NativeCommandResponseError'
    this.nativeOutcome = {
      requestId: value.requestId,
      status: 'failed',
      error: { code: 'UNCERTAIN', message: this.message, retryable: false, uncertain: true },
      ...('financial' in value && value.financial ? { financial: value.financial } : {}),
      ...('usage' in value && value.usage ? { usage: value.usage } : {}),
    }
  }
}
const commandStatuses: Record<CopilotRequest['command'], readonly CopilotResponse['status'][]> = {
  message: ['completed', 'suspended', 'refused', 'failed'],
  'pending.list': ['pending_targets', 'refused', 'failed'],
  'tool.approve': ['completed', 'suspended', 'refused', 'failed'],
  'tool.decline': ['completed', 'suspended', 'refused', 'failed'],
  'tool.execute': ['completed', 'suspended', 'refused', 'failed'],
  'tool.result': ['completed', 'suspended', 'refused', 'failed'],
  cancel: ['cancel_requested', 'refused', 'failed'],
  'threads.list': ['threads', 'refused', 'failed'],
  'history.read': ['history', 'refused', 'failed'],
  'thread.title': ['updated', 'refused', 'failed'],
  'history.edit': ['updated', 'refused', 'failed'],
  'thread.delete': ['updated', 'refused', 'failed'],
  'context.read': ['context', 'refused', 'failed'],
  'context.compact': ['compacted', 'refused', 'failed'],
}
export function assertNativeCommandResponse(
  command: CopilotRequest['command'],
  value: CopilotResponse
) {
  if (!commandStatuses[command].includes(value.status)) throw new NativeCommandResponseError(value)
}
