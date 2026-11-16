import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentExecutionOptions } from '@mastra/core/agent'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { InputProcessor } from '@mastra/core/processors'
import { isRunFenceConflictError } from '@mastra/core/storage'
import type { ChunkType } from '@mastra/core/stream'
import { z } from 'zod'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { validateNativeBrowserAssertion } from '@/lib/copilot/native/browser-assertion'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import {
  COPILOT_CONTEXT_PART,
  type CopilotOutputEvent,
  type CopilotRequest,
  CopilotRequestSchema,
  type CopilotResponse,
  type CopilotThreadEvent,
  type CopilotToolContext,
  type ErrorResponse,
  type HistoryResponse,
  type Json,
  type Pending,
  type Scope,
  ToolContextSchema,
} from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { readNativeThread, readNativeThreadHistory } from '@/lib/copilot/native/history'
import { nativeAdmissionId, nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { readbackNativeToolResult } from '@/lib/copilot/native/readback'
import {
  authorizeNativeConversationScope,
  resolveNativePendingTarget,
  type ServerPending,
} from '@/lib/copilot/native/target'
import { processContextsServer } from '@/lib/copilot/process-contents'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { dispatchBackgroundExecution } from '@/lib/execution/background-execution'
import type { PendingExecutionPayload } from '@/lib/execution/pending-execution'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { safeInferenceError } from '@/lib/mastra/errors'
import { projectNativeMessage } from '@/lib/mastra/messages'
import { parseNativeToolArguments } from '@/lib/mastra/options'
import { prepareModelRequest } from '@/lib/mastra/request'
import { getNativeFinalText } from '@/lib/mastra/result'
import { getAgentMemory, getCopilotAgent, getNativeMemoryStore } from '@/lib/mastra/runtime'
import { getTriggerExecutionState } from '@/lib/trigger/settings'
import { SSE_HEADERS } from '@/lib/utils'
import {
  type CopilotDecision,
  CopilotSuspendSchema,
  createCopilotRequestContext,
  getCopilotExecution,
  readCopilotRun,
  resolveCopilotRunToolContext,
} from './context'
import {
  assertCopilotRunActive,
  assertCopilotThreadReady,
  type CopilotJobState,
  type CopilotRun,
  cancelCopilotRun,
  claimCopilotAdmission,
  claimCopilotThread,
  deleteCopilotRunSnapshot,
  deleteCopilotThread,
  isCopilotJobActive,
  isCopilotRunCancelled,
  readCopilotAdmission,
  readCopilotJob,
  readCopilotThreadOwnership,
  readCopilotThreadRun,
} from './state'

const CANCELLATION_POLL_INTERVAL = 500
const CANCELLATION_TIMEOUT = 30_000

async function requireThread(scope: Scope, threadId: string, signal?: AbortSignal) {
  const thread = await readNativeThread(scope, threadId, signal)
  if (!thread) throw new NativeTargetError('Copilot thread is unavailable', 404)
  return thread
}

/** Supported native discovery owns suspension state, including after a restart. */
export async function listCopilotPending(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal
): Promise<ServerPending[]> {
  await requireThread(scope, threadId, signal)
  const { resourceId } = nativeConversationIdentity(scope)
  const agent = await getCopilotAgent()
  const { runs } = await agent.listSuspendedRuns({ threadId, resourceId })
  const pending: ServerPending[] = []
  for (const suspended of runs) {
    if (await isCopilotRunCancelled(suspended.runId)) continue
    const run = await readCopilotRun(scope, threadId, suspended.runId)
    for (const call of suspended.toolCalls) {
      if (!call.toolCallId || !call.toolName || !isToolId(call.toolName))
        throw new NativeTargetError('Suspended Copilot tool is unavailable', 409)
      const payload = call.requiresApproval
        ? undefined
        : CopilotSuspendSchema.parse(call.suspendPayload)
      const args = parseNativeToolArguments(
        call.requiresApproval ? call.args : payload!.originalArgs
      )
      const originalArgs = ToolArgSchemas[call.toolName].parse(args)
      pending.push({
        target: {
          threadId,
          resourceId,
          runId: suspended.runId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
        },
        stage: call.requiresApproval ? 'approval' : 'result',
        originalArgs,
        context: resolveCopilotRunToolContext(run, call.toolName, originalArgs),
        ...(payload?.preview
          ? { preview: payload.preview, reviewBaseStateHash: payload.reviewBaseStateHash }
          : {}),
      })
    }
  }
  return pending
}

function publicPending({ target, stage, originalArgs, context, preview }: ServerPending): Pending {
  return { target, stage, originalArgs, context, ...(preview ? { preview } : {}) }
}

function failure(error: unknown, apiKey?: string): ErrorResponse {
  const ownershipLost = isRunFenceConflictError(error)
  const status = ownershipLost ? 409 : error instanceof NativeTargetError ? error.status : 503
  return {
    status: status < 500 ? 'refused' : 'failed',
    error: {
      code:
        status === 403
          ? 'FORBIDDEN'
          : status === 409
            ? 'STALE_TARGET'
            : status < 500
              ? 'INVALID_REQUEST'
              : 'GENERATION_FAILED',
      message: ownershipLost
        ? 'This conversation changed before the request completed.'
        : safeInferenceError(error, apiKey),
    },
  }
}

/** Both the initial response and reconnects project the same native model events. */
function projectChunk<T>(part: ChunkType<T>): CopilotOutputEvent | undefined {
  if (part.type === 'text-delta' || part.type === 'reasoning-delta')
    return {
      type: part.type === 'text-delta' ? 'text.delta' : 'reasoning.delta',
      text: part.payload.text,
    }
  if (part.type === 'tool-call') {
    const args = isToolId(part.payload.toolName)
      ? ToolArgSchemas[part.payload.toolName].safeParse(part.payload.args)
      : undefined
    return {
      type: 'tool.display',
      toolCallId: part.payload.toolCallId,
      toolName: part.payload.toolName,
      ...(args?.success ? { args: args.data } : {}),
    }
  }
  if (part.type === 'tool-result')
    return {
      type: 'tool.result',
      toolCallId: part.payload.toolCallId,
      toolName: part.payload.toolName,
      result: part.payload.isError
        ? { error: 'This Studio tool did not complete successfully' }
        : (part.payload.result as Json),
      ...(part.payload.isError ? { isError: true } : {}),
    }
  if (part.type === 'tool-error' || part.type === 'tool-output-denied')
    return {
      type: 'tool.result',
      toolCallId: part.payload.toolCallId,
      toolName: part.payload.toolName,
      result: {
        error:
          part.type === 'tool-error'
            ? 'This Studio tool did not complete successfully'
            : 'This tool call was declined',
      },
      ...(part.type === 'tool-error' ? { isError: true } : { denied: true }),
    }
}

async function waitForRunRelease(
  scope: Scope,
  threadId: string,
  runId: string,
  signal: AbortSignal
) {
  while (true) {
    const owner = await readCopilotThreadOwnership(scope, threadId)
    if (!owner?.live || owner.ownerId !== runId) break
    signal.throwIfAborted()
    await delay(CANCELLATION_POLL_INTERVAL, undefined, { signal })
  }
  signal.throwIfAborted()
}

async function readCopilotHistory(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal
): Promise<HistoryResponse> {
  return {
    status: 'history',
    threadId,
    items: await readNativeThreadHistory(scope, threadId, signal),
    pending: (await listCopilotPending(scope, threadId, signal)).map(publicPending),
  }
}

async function* observeThread(
  scope: Scope,
  threadId: string,
  signal: AbortSignal
): AsyncGenerator<CopilotThreadEvent> {
  const subscription = await (await getCopilotAgent()).subscribeToThread({
    ...nativeConversationIdentity(scope),
    threadId,
    withInitialHistory: { perPage: Number.MAX_SAFE_INTEGER },
  })
  const detach = () => subscription.unsubscribe()
  signal.addEventListener('abort', detach, { once: true })
  try {
    const iterator = subscription.stream[Symbol.asyncIterator]()
    let next = iterator.next()
    let watchingJob = false
    while (!signal.aborted) {
      let clearTick: (() => void) | undefined
      const received = await (watchingJob
        ? Promise.race([
            next,
            new Promise<undefined>((resolve) => {
              const timer = setTimeout(resolve, CANCELLATION_POLL_INTERVAL)
              clearTick = () => clearTimeout(timer)
            }),
          ]).finally(() => clearTick?.())
        : next)
      if (signal.aborted) return
      if (!received) {
        const job = await readCopilotJob(scope, threadId)
        const owner = await readCopilotThreadOwnership(scope, threadId)
        if (owner?.live || (job && (await isCopilotJobActive(job)))) continue
        if (job) {
          if (!job.status) {
            await interruptCopilotJob(
              scope,
              threadId,
              job,
              'This response was interrupted. You can continue this conversation.'
            )
          }
          const settled = await readCopilotJob(scope, threadId)
          if (settled?.id !== job.id || !settled.status) continue
          yield {
            type: 'thread.status',
            runId: settled.runId,
            status: settled.status,
            history: await readCopilotHistory(scope, threadId, signal),
            ...(settled.error ? { error: settled.error } : {}),
          }
        }
        watchingJob = false
        continue
      }
      if (received.done) return
      const part = received.value
      if (part.type === 'thread-history') {
        const job = await readCopilotJob(scope, threadId)
        const owner = await readCopilotThreadOwnership(scope, threadId)
        const activeRunId = owner?.live
          ? owner.ownerId
          : job && (await isCopilotJobActive(job))
            ? job.runId
            : null
        yield {
          type: 'thread.history',
          result: {
            status: 'history',
            threadId,
            items: part.payload.messages.map(projectNativeMessage),
            pending: (await listCopilotPending(scope, threadId, signal)).map(publicPending),
          },
          activeRunId,
          ...(job?.error ? { error: job.error } : {}),
          ...(!activeRunId && !job?.status && (job || owner?.leaseExpiresAt)
            ? { interruptedRunId: job?.runId ?? owner!.ownerId }
            : {}),
        }
        watchingJob = !!job || !!owner?.live
      } else if (
        part.type === 'start' ||
        (part.type === 'step-start' && typeof part.payload.messageId === 'string')
      ) {
        if (typeof part.payload.messageId !== 'string')
          throw new Error('Native response is missing its assistant message ID')
        watchingJob = true
        yield { type: 'thread.started', runId: part.runId, messageId: part.payload.messageId }
      } else {
        const event = projectChunk(part)
        if (event) yield { type: 'thread.output', runId: part.runId, event }
      }
      next = iterator.next()
    }
  } finally {
    signal.removeEventListener('abort', detach)
    detach()
  }
}

async function readCommand(
  request: CopilotRequest,
  scope: Scope,
  signal?: AbortSignal
): Promise<CopilotResponse | undefined> {
  const store = await getNativeMemoryStore()
  const resourceId = nativeConversationIdentity(scope).resourceId
  if (request.command === 'threads.list') {
    const result = await store.listThreads({
      perPage: false,
      filter: { resourceId },
      orderBy: { field: 'updatedAt', direction: 'DESC' },
    })
    return {
      status: 'threads',
      items: result.threads.map((thread) => ({
        id: thread.id,
        title: thread.title ?? '',
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      })),
    }
  }
  if (!('threadId' in request) || !request.threadId || request.command === 'message') return
  await requireThread(scope, request.threadId, signal)
  switch (request.command) {
    case 'thread.title':
      await store.updateThread({ id: request.threadId, title: request.title })
      return { status: 'updated', threadId: request.threadId, operation: 'thread.title' }
    case 'thread.delete':
      await deleteCopilotThread(scope, request.threadId)
      return {
        status: 'updated',
        threadId: request.threadId,
        operation: 'thread.delete',
      }
    case 'cancel': {
      const currentRunId = await readCopilotThreadRun(scope, request.threadId)
      if (currentRunId && currentRunId !== request.runId)
        throw new NativeTargetError('Copilot cancellation target differs', 403)
      if (currentRunId) {
        const run = { runId: currentRunId, threadId: request.threadId, scope }
        const agent = await getCopilotAgent()
        await cancelCopilotRun(run)
        agent.abortThreadStream({ threadId: run.threadId, resourceId, expectedRunId: run.runId })
      }
      const waiting = AbortSignal.any(
        [signal, AbortSignal.timeout(CANCELLATION_TIMEOUT)].filter(
          (item): item is AbortSignal => !!item
        )
      )
      let ownership: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
      try {
        const queued = await readCopilotJob(scope, request.threadId)
        const admission = await readCopilotThreadOwnership(scope, request.threadId)
        const expectedGeneration =
          queued?.runId === request.runId && queued.admissionGeneration === admission?.generation
            ? queued.admissionGeneration
            : undefined
        if (expectedGeneration === undefined)
          await waitForRunRelease(scope, request.threadId, request.runId, waiting)
        waiting.throwIfAborted()
        if (currentRunId) {
          const job = await readCopilotJob(scope, request.threadId)
          const owner = await readCopilotThreadOwnership(scope, request.threadId)
          if (
            (owner?.live && owner.ownerId !== request.runId) ||
            (job && job.runId !== request.runId)
          ) {
            await deleteCopilotRunSnapshot(request.runId)
            return { status: 'cancel_requested', runId: request.runId }
          }
          ownership = await claimCopilotThread(
            scope,
            request.threadId,
            request.runId,
            job?.id,
            expectedGeneration
          )
          await ownership.run(async () => {
            await deleteCopilotRunSnapshot(request.runId)
            if (job?.runId === request.runId && !job.status)
              await saveCopilotJob(scope, request.threadId, job.id, { status: 'aborted' })
          })
        }
      } catch (error) {
        signal?.throwIfAborted()
        if (!waiting.aborted && !(error instanceof NativeTargetError && error.status === 409))
          throw error
        throw new NativeTargetError(
          'Copilot cancellation has not finished. Try stopping it again.',
          503
        )
      } finally {
        await ownership?.release()
      }
      return { status: 'cancel_requested', runId: request.runId }
    }
  }
}

function inputMessage(
  request: Extract<CopilotRequest, { command: 'message' }>,
  run: Pick<CopilotRun, 'threadId' | 'scope'>,
  messageId: string
): MastraDBMessage {
  const content = request.input.content
  const parts: MastraDBMessage['content']['parts'] =
    typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : content.map((part) =>
          part.type === 'text'
            ? part
            : { type: 'file' as const, data: part.image, mimeType: part.mediaType }
        )
  if (request.input.contexts?.length)
    parts.push({ type: COPILOT_CONTEXT_PART, data: request.input.contexts })
  return {
    id: messageId,
    role: 'user',
    threadId: run.threadId,
    resourceId: nativeConversationIdentity(run.scope).resourceId,
    createdAt: new Date(),
    content: { format: 2, parts },
  }
}

const CopilotJobSchema = z.object({
  request: CopilotRequestSchema,
  actorUserId: z.string().min(1),
  toolContexts: z.array(ToolContextSchema),
  threadId: z.string().min(1),
  runId: z.string().min(1),
  jobId: z.string().min(1),
  messageId: z.string().min(1).optional(),
})

async function saveCopilotJob(
  scope: Scope,
  threadId: string,
  jobId: string,
  update: Partial<CopilotJobState>
) {
  const store = await getNativeMemoryStore()
  const thread = await store.getThreadById({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  const job = thread?.metadata?.copilotJob as CopilotJobState | undefined
  if (!job || job.id !== jobId) throw new NativeTargetError('This Copilot turn has changed', 409)
  await store.updateThread({
    id: threadId,
    metadata: { ...thread!.metadata, copilotJob: { ...job, ...update } },
  })
}

async function dispatchCopilotCommand(
  request: CopilotRequest,
  scope: Scope,
  toolContexts: CopilotToolContext[],
  signal?: AbortSignal
): Promise<CopilotResponse> {
  if (!('requestId' in request))
    throw new NativeTargetError('This command does not generate a response', 422)
  if (request.command === 'message' && request.messageId && !request.threadId)
    throw new NativeTargetError('Editing a message requires its conversation', 422)
  const jobId = nativeAdmissionId(scope, request.requestId)
  const threadId =
    request.command === 'message' ? (request.threadId ?? jobId) : request.target.threadId
  const runId = request.command === 'message' ? jobId : request.target.runId
  const messageId = request.command === 'message' ? (request.messageId ?? jobId) : undefined
  const accepted = {
    status: 'accepted' as const,
    threadId,
    runId,
    ...(messageId ? { messageId } : {}),
  }
  const run = { scope, threadId, runId }
  if (await readCopilotAdmission(run, request)) return accepted
  const { mode } = await getTriggerExecutionState()
  if (mode === 'unavailable')
    throw new NativeTargetError('Background execution is unavailable', 503)
  if (mode === 'trigger' && !process.env.REDIS_URL)
    throw new NativeTargetError('REDIS_URL is required for Copilot streaming across workers', 503)
  let ownership: Awaited<ReturnType<typeof claimCopilotThread>>
  try {
    if (request.command === 'message') {
      if (request.threadId) await requireThread(scope, threadId, signal)
    } else {
      await resolveNativePendingTarget(
        scope,
        request.target,
        request.command === 'tool.approve' || request.command === 'tool.decline'
          ? 'approval'
          : 'result',
        signal
      )
    }
    ownership = await claimCopilotThread(scope, threadId, runId)
  } catch (error) {
    // A retry can arrive while the original admission still holds its native claim.
    for (;;) {
      if (await readCopilotAdmission(run, request)) return accepted
      if (!(error instanceof NativeTargetError && error.status === 409)) break
      const owner = await readCopilotThreadOwnership(scope, threadId)
      if (!owner?.live || owner.ownerId !== runId) break
      if (request.command !== 'message' && (await readCopilotJob(scope, threadId))?.id !== jobId)
        break
      await delay(CANCELLATION_POLL_INTERVAL, undefined, { signal })
    }
    throw error
  }
  const job: CopilotJobState = {
    id: jobId,
    runId,
    ...(mode === 'local' ? { admissionGeneration: ownership.fence.generation } : {}),
  }
  let localDispatched = false
  try {
    if (await readCopilotAdmission(run, request)) return accepted
    if (request.command === 'message') await assertCopilotThreadReady(scope, threadId)
    else await assertCopilotRunActive(runId)
    await ownership.run(async () => {
      const store = await getNativeMemoryStore()
      if (request.command === 'message' && !request.threadId) {
        await (await getAgentMemory()).createThread({
          threadId,
          resourceId: nativeConversationIdentity(scope).resourceId,
          title: '',
          metadata: { product: 'copilot', copilotJob: job },
        })
      } else {
        const thread = await requireThread(scope, threadId, signal)
        await store.updateThread({
          id: threadId,
          metadata: { ...thread.metadata, copilotJob: job },
        })
      }
      if (request.command === 'message') {
        const message = inputMessage(request, { threadId, scope }, messageId!)
        let following: MastraDBMessage[] = []
        if (request.messageId) {
          const history = await store.listMessages({
            threadId,
            resourceId: nativeConversationIdentity(scope).resourceId,
            perPage: false,
            orderBy: { field: 'createdAt', direction: 'ASC' },
          })
          const index = history.messages.findIndex((item) => item.id === request.messageId)
          const original = history.messages[index]
          if (
            !original ||
            original.role !== 'user' ||
            !original.content.parts.length ||
            original.content.parts.some(
              (part) => part.type !== 'text' && part.type !== COPILOT_CONTEXT_PART
            ) ||
            typeof request.input.content !== 'string'
          )
            throw new NativeTargetError('Only plain text user messages can be edited', 422)
          const originalContexts = original.content.parts.find(
            (part) => part.type === COPILOT_CONTEXT_PART
          )
          if (
            stableStringifyJsonValue(
              originalContexts && 'data' in originalContexts ? originalContexts.data : []
            ) !== stableStringifyJsonValue(request.input.contexts ?? [])
          )
            throw new NativeTargetError('Message context cannot be changed while editing', 422)
          following = history.messages.slice(index + 1)
          if (
            following.some((item) =>
              item.content.parts.some((part) => part.type === 'tool-invocation')
            )
          )
            throw new NativeTargetError(
              'Start a new message after tool activity to preserve its history',
              409
            )
          message.createdAt = original.createdAt
        }
        // Acceptance commits the input before any queued inference preparation can fail.
        await store.saveMessages({ messages: [message] })
        if (following.length) await store.deleteMessages(following.map((item) => item.id))
      }
      await claimCopilotAdmission(run, request)
    })
    signal?.throwIfAborted()
    const triggerRunId = await dispatchBackgroundExecution(
      {
        id: job.id,
        executionType: 'copilot',
        payload: {
          request,
          actorUserId: scope.actorUserId,
          toolContexts,
          threadId,
          runId,
          jobId: job.id,
          messageId,
        },
      },
      mode
    )
    localDispatched = mode === 'local'
    if (triggerRunId)
      await ownership.run(() => saveCopilotJob(scope, threadId, job.id, { triggerRunId }))
    return accepted
  } catch (error) {
    if (!ownership.signal.aborted && (await readCopilotJob(scope, threadId))?.id === job.id)
      await ownership.run(() =>
        saveCopilotJob(scope, threadId, job.id, {
          status: 'failed',
          error: failure(error).error,
        })
      )
    throw error
  } finally {
    if (localDispatched) await ownership.handoff()
    else await ownership.release()
  }
}

async function interruptCopilotJob(
  scope: Scope,
  threadId: string,
  job: CopilotJobState,
  message: string
) {
  await waitForRunRelease(scope, threadId, job.runId, AbortSignal.timeout(CANCELLATION_TIMEOUT))
  const ownership = await claimCopilotThread(scope, threadId, job.runId, job.id)
  try {
    await ownership.run(async () => {
      const current = await readCopilotJob(scope, threadId)
      if (current?.status) return
      await cancelCopilotRun({ runId: job.runId, threadId, scope })
      await deleteCopilotRunSnapshot(job.runId)
      await saveCopilotJob(scope, threadId, job.id, {
        status: 'failed',
        error: failure(new Error(message)).error,
      })
    })
  } finally {
    await ownership.release()
  }
}

/** Worker lifecycle failures retain their explanation in native thread metadata. */
export async function finalizeCopilotJob(value: PendingExecutionPayload, message: string) {
  const job = CopilotJobSchema.parse(value)
  const scope: Scope = { actorUserId: job.actorUserId, workspaceId: job.request.workspaceId }
  const current = await readCopilotJob(scope, job.threadId)
  if (current?.id === job.jobId && !current.status)
    await interruptCopilotJob(scope, job.threadId, current, message)
}

export async function executeCopilotJob(value: PendingExecutionPayload, abortSignal?: AbortSignal) {
  const { request, toolContexts, actorUserId, threadId, runId, jobId, messageId } =
    CopilotJobSchema.parse(value)
  const scope: Scope = { actorUserId, workspaceId: request.workspaceId }
  const cancellation = new AbortController()
  const abort = () => cancellation.abort(abortSignal?.reason)
  abortSignal?.addEventListener('abort', abort, { once: true })
  if (abortSignal?.aborted) abort()
  let outcome: Pick<CopilotJobState, 'status' | 'error'> = { status: 'failed' }
  let run: CopilotRun | undefined
  let apiKey: string | undefined
  let watcher: ReturnType<typeof setInterval> | undefined
  let usage: Awaited<ReturnType<typeof prepareModelRequest>>['usage'] | undefined
  let ownership: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
  let nativeStarted = false
  let nativeOutput: { getFullOutput(): Promise<{ finishReason?: string }> } | undefined
  let requestContext: ReturnType<typeof createCopilotRequestContext> | undefined
  const assertOwnership = async () => {
    cancellation.signal.throwIfAborted()
    await ownership!.renew()
    cancellation.signal.throwIfAborted()
  }
  try {
    const currentJob = await readCopilotJob(scope, threadId)
    if (currentJob?.id !== jobId) throw new NativeTargetError('This Copilot turn has changed', 409)
    if (currentJob.status) {
      outcome = currentJob
      return
    }
    const { admissionGeneration } = currentJob
    if (admissionGeneration === undefined)
      await waitForRunRelease(scope, threadId, runId, cancellation.signal)
    ownership = await claimCopilotThread(scope, threadId, runId, jobId, admissionGeneration)
    ownership.signal.addEventListener('abort', () => cancellation.abort(ownership!.signal.reason), {
      once: true,
    })
    let checking = false
    watcher = setInterval(() => {
      if (checking) return
      checking = true
      void assertCopilotRunActive(runId)
        .catch((error) => cancellation.abort(error))
        .finally(() => {
          checking = false
        })
    }, CANCELLATION_POLL_INTERVAL)
    await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
    await assertCopilotRunActive(runId)
    const agent = await getCopilotAgent()
    const signal = cancellation.signal
    let pending: ServerPending | undefined
    let decision: CopilotDecision | undefined
    if (request.command === 'message') {
      apiKey = (await resolveCopilotModel(request.model)).apiKey
      await requireThread(scope, threadId, signal)
      run = {
        runId,
        threadId,
        scope,
        model: request.model,
        accessLevel: request.accessLevel ?? 'limited',
        toolContext: request.toolContext,
        toolContexts,
      }
      await assertCopilotThreadReady(scope, threadId)
    } else if ('target' in request) {
      pending = await resolveNativePendingTarget(
        scope,
        request.target,
        request.command === 'tool.approve' || request.command === 'tool.decline'
          ? 'approval'
          : 'result',
        signal
      )
      run = await readCopilotRun(scope, pending.target.threadId, pending.target.runId)
      await assertCopilotRunActive(run.runId)
      apiKey = (await resolveCopilotModel(run.model)).apiKey
      await assertCopilotRunActive(run.runId)
      if (request.command !== 'tool.execute') await authorizeNativeBusinessResult(scope, pending)
      if (request.command === 'tool.result') {
        validateNativeBrowserAssertion(pending, request.assertion)
        decision = {
          action: 'result',
          result:
            request.assertion.kind === 'ui.opened'
              ? {
                  message:
                    'The requested Studio dialog was opened. User completion is still required.',
                }
              : request.assertion.data,
        }
      } else if (request.command === 'tool.execute') {
        const toolContext = pending.context
        const businessContext = { ...toolContext, userId: run.scope.actorUserId, signal }
        for (const [key, value] of Object.entries(request.context ?? {})) {
          if (value === undefined || value === toolContext?.[key as keyof typeof toolContext])
            continue
          if (
            key === 'workspaceId' &&
            !toolContext?.workspaceId &&
            ['gdrive_request_access', 'oauth_request_access'].includes(pending.target.toolName)
          ) {
            await authorizeNativeConversationScope(run.scope.actorUserId, value)
            businessContext.workspaceId = value
          } else throw new NativeTargetError('The original tool context has changed', 403)
        }
        if (request.action !== 'readback')
          await authorizeNativeBusinessResult(run.scope, pending, undefined, businessContext)
        if (request.action === 'readback') {
          decision = {
            action: 'result',
            result: await readbackNativeToolResult(
              run.scope,
              pending,
              businessContext,
              request.readback
            ),
          }
        } else if (request.action === 'review.accept' || request.action === 'review.reject') {
          if (!pending.preview || !pending.reviewBaseStateHash)
            throw new NativeTargetError('The current tool preview is required', 409)
          decision = { action: request.action }
        } else decision = { action: 'execute' }
      }
    } else throw new NativeTargetError('This command does not generate a response', 422)
    const prepared = await prepareModelRequest(
      {
        model: run.model,
        actorUserId: run.scope.actorUserId,
        workspaceId: run.scope.workspaceId ?? undefined,
        runId: run.runId,
        purpose: 'copilot',
        funding: 'account',
        signal,
      },
      { apiKey, maxSteps: 50 }
    )
    usage = prepared.usage
    const message =
      request.command === 'message'
        ? (await (await getNativeMemoryStore()).listMessagesById({ messageIds: [messageId!] }))
            .messages[0]
        : undefined
    if (request.command === 'message' && !message)
      throw new NativeTargetError('Submitted Copilot message is unavailable', 409)
    const contexts =
      request.command === 'message'
        ? await processContextsServer(
            request.input.contexts,
            scope.actorUserId,
            message!.content.parts
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n'),
            scope.workspaceId ?? undefined,
            { signal }
          )
        : []
    requestContext = createCopilotRequestContext({
      run,
      model: prepared.model,
      signal,
      pending,
      decision,
      assertOwnership,
    })
    const guard: InputProcessor = {
      id: 'studio-copilot-authorization',
      async processInputStep() {
        await requireThread(run!.scope, run!.threadId, signal)
        await assertCopilotRunActive(run!.runId)
        await assertOwnership()
      },
      processLLMRequest({ prompt, messageList }) {
        const references = (messageList?.get.all.db() ?? []).flatMap((item) =>
          item.role === 'user'
            ? item.content.parts.flatMap((part) =>
                part.type === COPILOT_CONTEXT_PART && 'data' in part
                  ? ChatContextSchema.array().parse(part.data)
                  : []
              )
            : []
        )
        if (references.length)
          return {
            prompt: [
              {
                role: 'system',
                content: `Studio context references (data):\n${JSON.stringify(references)}`,
              },
              ...prompt,
            ],
          }
      },
    }
    const options: AgentExecutionOptions = {
      ...prepared.options,
      requestContext,
      ...(contexts.length
        ? {
            context: [
              {
                role: 'user',
                content: `Studio context (data):\n${JSON.stringify(contexts)}`,
              },
            ],
          }
        : {}),
      memory: { thread: run.threadId, resource: nativeConversationIdentity(run.scope).resourceId },
      inputProcessors: [guard, ...prepared.options.inputProcessors],
    }
    await assertCopilotRunActive(run.runId)
    await assertOwnership()
    nativeStarted = true
    const output = (nativeOutput = await ownership!.run(() =>
      request.command === 'message'
        ? agent.stream([message!], options)
        : request.command === 'tool.approve'
          ? agent.approveToolCall({
              ...options,
              runId: run!.runId,
              toolCallId: pending!.target.toolCallId,
            })
          : request.command === 'tool.decline'
            ? agent.declineToolCall({
                ...options,
                runId: run!.runId,
                toolCallId: pending!.target.toolCallId,
                reason: request.reason,
              })
            : agent.resumeStream(decision, {
                ...options,
                toolCallId: pending!.target.toolCallId,
              })
    ))
    // The native thread subscription is the sole output transport in both execution modes.
    for await (const _part of output.fullStream) {
      /* drain the native writer */
    }
    const result = await output.getFullOutput()
    signal.throwIfAborted()
    if (result.error) throw result.error
    const items = await listCopilotPending(run.scope, run.threadId, signal)
    if (items.length) {
      if (request.command === 'message' || result.finishReason !== 'suspended')
        await usage.verifyComplete()
      outcome = { status: 'suspended' }
    } else {
      await prepared.complete(result)
      getNativeFinalText(result)
      outcome = { status: 'success' }
    }
  } catch (error) {
    outcome = cancellation.signal.aborted
      ? { status: 'aborted' }
      : { status: 'failed', error: failure(error, apiKey).error }
    if (!ownership) throw error
  } finally {
    try {
      // stream() can reject during startup, including after it started asynchronous work.
      if (ownership && !ownership.signal.aborted && run && nativeStarted && !nativeOutput) {
        cancellation.abort()
        ;(await getCopilotAgent()).abortThreadStream({
          threadId: run.threadId,
          resourceId: nativeConversationIdentity(scope).resourceId,
          expectedRunId: run.runId,
        })
      }
      // Rejection is also a settled native result. Keep the lease through actual tool drainage.
      await nativeOutput?.getFullOutput().catch(() => undefined)
      if (requestContext) await Promise.all(getCopilotExecution(requestContext)!.pendingTools)
      if (ownership && run && cancellation.signal.aborted && !ownership.signal.aborted) {
        await ownership.renew()
        await cancelCopilotRun(run)
        await deleteCopilotRunSnapshot(run.runId)
      }
    } finally {
      if (watcher) clearInterval(watcher)
      try {
        if (ownership && !ownership.signal.aborted) {
          await ownership.run(() => saveCopilotJob(scope, threadId, jobId, outcome))
        }
      } finally {
        await ownership?.release()
        abortSignal?.removeEventListener('abort', abort)
      }
    }
  }
}

export async function executeCopilotCommand(
  request: CopilotRequest,
  actorUserId: string,
  signal?: AbortSignal,
  toolContexts: CopilotToolContext[] = []
): Promise<Response> {
  signal?.throwIfAborted()
  const scope = await authorizeNativeConversationScope(actorUserId, request.workspaceId)
  try {
    const result = await readCommand(request, scope, signal)
    if (result) return Response.json(result)
    if (request.command !== 'thread.observe')
      return Response.json(await dispatchCopilotCommand(request, scope, toolContexts, signal), {
        status: 202,
      })
  } catch (error) {
    return Response.json(failure(error), {
      status: isRunFenceConflictError(error)
        ? 409
        : error instanceof NativeTargetError
          ? error.status
          : 503,
    })
  }
  signal?.throwIfAborted()
  if (request.command !== 'thread.observe') throw new Error('Expected thread observation')
  const cancellation = new AbortController()
  const events = observeThread(scope, request.threadId, cancellation.signal)
  const encoder = new TextEncoder()
  let detached = false
  const detach = () => {
    detached = true
    cancellation.abort()
  }
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        signal?.addEventListener('abort', detach, { once: true })
        if (signal?.aborted) detach()
        const heartbeat = setInterval(() => {
          if (!detached) controller.enqueue(encoder.encode(': keep-alive\n\n'))
        }, 25_000)
        try {
          for await (const event of events) {
            if (!detached) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          }
          if (!detached) controller.close()
        } catch (error) {
          if (!detached) controller.error(error)
        } finally {
          clearInterval(heartbeat)
          signal?.removeEventListener('abort', detach)
        }
      },
      cancel: detach,
    }),
    { headers: SSE_HEADERS }
  )
}
