import type { RunFence } from '@mastra/core/storage'
import type { LanguageModelUsage } from '@mastra/core/stream'
import { z } from 'zod'
import type { JsonObject } from '@/lib/copilot/native/contract'
import { CopilotRequestSchema, ToolContextSchema } from '@/lib/copilot/native/contract'
import type { ServerPending } from '@/lib/copilot/native/target'
import type { processContextsServer } from '@/lib/copilot/process-contents'
import type { ToolId } from '@/lib/copilot/registry'
import type { NativeCost } from '@/lib/mastra/usage'
import type { CopilotDecision } from './context'
import type { CopilotRun } from './ownership'

export const COPILOT_CANCELLATION_POLL_INTERVAL = 500

export const CopilotSuspendSchema = z.object({
  originalArgs: z.record(z.string(), z.json()),
  preview: z.record(z.string(), z.json()).optional(),
  reviewBaseStateHash: z.string().min(1).optional(),
})
export const CopilotWorkerToolResultSchema = z.union([
  z.object({ result: z.unknown() }).strict(),
  z.object({ suspend: CopilotSuspendSchema }).strict(),
  z.object({ error: z.string().min(1) }).strict(),
])

const [messageCommand, ...otherCommands] = CopilotRequestSchema.options

export const CopilotJobSchema = z.object({
  // Input is already committed to native memory; jobs carry only its message identity.
  request: z.discriminatedUnion('command', [
    messageCommand.omit({ input: true }),
    ...otherCommands,
  ]),
  actorUserId: z.string().min(1),
  toolContexts: z.array(ToolContextSchema),
  threadId: z.string().min(1),
  runId: z.string().min(1),
  jobId: z.string().min(1),
  messageId: z.string().min(1).optional(),
})
export type CopilotJob = z.infer<typeof CopilotJobSchema>
export type CopilotWorkerToolInput = {
  run: CopilotRun
  pending?: ServerPending
  decision?: CopilotDecision
  toolName: ToolId
  args: JsonObject
  toolCallId: string
  fence: RunFence
}
export type CopilotWorkerToolResult = z.infer<typeof CopilotWorkerToolResultSchema>
export interface CopilotWorkerPrepared {
  run: CopilotRun
  pending?: ServerPending
  decision?: CopilotDecision
  contexts: Awaited<ReturnType<typeof processContextsServer>>
  model: { providerId: string; modelId: string; apiKey: string }
}
export interface CopilotWorkerOperations {
  prepare: { input: { fence: RunFence }; output: CopilotWorkerPrepared }
  active: { input: { fence: RunFence }; output: undefined }
  cancel: { input: Record<string, never>; output: undefined }
  finalize: { input: { message: string }; output: undefined }
  tool: { input: CopilotWorkerToolInput; output: CopilotWorkerToolResult }
  'usage.allow': { input: { fence: RunFence }; output: undefined }
  'usage.record': {
    input: {
      usage: Partial<LanguageModelUsage>
      providerMetadata?: Record<string, unknown>
      attemptId: string
    }
    output: NativeCost
  }
}
export type CopilotWorkerOperation = keyof CopilotWorkerOperations
export const CopilotWorkerOperationSchema = z.enum([
  'prepare',
  'active',
  'cancel',
  'finalize',
  'tool',
  'usage.allow',
  'usage.record',
])
export const CopilotWorkerIdentitySchema = z
  .object({
    actorUserId: z.string().min(1),
    workspaceId: z.string().min(1).nullable(),
    threadId: z.string().min(1),
    runId: z.string().min(1),
    jobId: z.string().min(1),
  })
  .strict()
export type CopilotWorkerIdentity = z.infer<typeof CopilotWorkerIdentitySchema> & {
  model?: string
}
export const CopilotWorkerRequestSchema = z
  .object({
    identity: CopilotWorkerIdentitySchema,
    operation: CopilotWorkerOperationSchema,
    input: z.record(z.string(), z.json()),
    job: CopilotJobSchema.optional(),
  })
  .strict()
