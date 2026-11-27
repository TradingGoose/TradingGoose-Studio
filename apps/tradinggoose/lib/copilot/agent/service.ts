import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { publishAbortRequest } from '@mastra/core/agent/durable'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import { isRunFenceConflictError } from '@mastra/core/storage'
import type { ChunkType } from '@mastra/core/stream'
import {
  COPILOT_CONTEXT_PART,
  type CopilotOutputEvent,
  type CopilotRequest,
  type CopilotResponse,
  type CopilotThreadEvent,
  type CopilotToolContext,
  type HistoryResponse,
  type Json,
  type Pending,
  type Scope,
} from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { publicCopilotMessage, readNativeThread } from '@/lib/copilot/native/history'
import {
  nativeAdmissionId,
  nativeConversationIdentity,
  nativeToolCallId,
} from '@/lib/copilot/native/identity'
import {
  authorizeNativeConversationScope,
  resolveNativePendingTarget,
  type ServerPending,
} from '@/lib/copilot/native/target'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import { dispatchBackgroundExecution } from '@/lib/execution/background-execution'
import type { PendingExecutionPayload } from '@/lib/execution/pending-execution'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { projectNativeMessage } from '@/lib/mastra/messages'
import { parseNativeToolArguments } from '@/lib/mastra/options'
import {
  getAgentMemory,
  getCopilotAgent,
  getMastra,
  getNativeMemoryStore,
} from '@/lib/mastra/runtime'
import { getTriggerExecutionState } from '@/lib/trigger/settings'
import { SSE_HEADERS } from '@/lib/utils'
import { readCopilotRun, resolveCopilotRunToolContext } from './context'
import { copilotFailure } from './errors'
import {
  type CopilotJobState,
  type CopilotRun,
  claimCopilotThread,
  deleteCopilotRunSnapshot,
  hasPendingWorkflowReadback,
  isCopilotJobActive,
  readCopilotJob,
  readCopilotThreadOwnership,
  saveCopilotJob,
  waitForCopilotRunRelease,
} from './ownership'
import {
  assertCopilotRunActive,
  cancelCopilotRun,
  cancelCopilotRunAfterWorkflows,
  claimCopilotAdmission,
  finishCopilotWorkflowCancellation,
  readCopilotAdmission,
  readCopilotCancellation,
} from './receipts'
import { assertCopilotThreadReady, deleteCopilotThread, readCopilotThreadRun } from './state'
import {
  COPILOT_CANCELLATION_POLL_INTERVAL,
  CopilotJobSchema,
  CopilotSuspendSchema,
} from './worker-contract'

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
  signal?: AbortSignal,
  privateDispatch = false
): Promise<ServerPending[]> {
  await requireThread(scope, threadId, signal)
  const { resourceId } = nativeConversationIdentity(scope)
  const agent = await getCopilotAgent()
  const { runs } = await agent.listSuspendedRuns({ threadId, resourceId })
  const pending: ServerPending[] = []
  for (const suspended of runs) {
    if ((await readCopilotCancellation(suspended.runId)) === 'settled') continue
    const run = await readCopilotRun(scope, threadId, suspended.runId)
    for (const call of suspended.toolCalls) {
      if (!call.toolCallId || !call.toolName || !isToolId(call.toolName))
        throw new NativeTargetError('Suspended Copilot tool is unavailable', 409)
      const payload = call.requiresApproval
        ? undefined
        : CopilotSuspendSchema.parse(call.suspendPayload)
      if (Boolean(payload?.studioDispatch) !== privateDispatch) continue
      if (
        privateDispatch &&
        (getCopilotToolPolicy(call.toolName).execution !== 'server' || payload?.preview)
      )
        throw new NativeTargetError('Invalid Studio dispatch stage', 409)
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

async function projectPendingJob(
  scope: Scope,
  threadId: string,
  job: CopilotJobState | undefined,
  signal?: AbortSignal
): Promise<Pick<HistoryResponse, 'pending' | 'readbackRequestId' | 'workflowObservation'>> {
  const pending = (await listCopilotPending(scope, threadId, signal)).map(publicPending)
  const observation = job?.workflowObservation
  return {
    pending,
    ...(job?.readbackRequestId ? { readbackRequestId: job.readbackRequestId } : {}),
    ...(job?.status === 'suspended' &&
    observation &&
    job.readbackRequestId === observation.requestId &&
    job.id === nativeAdmissionId(scope, observation.requestId) &&
    (await readCopilotJob(scope, threadId))?.id === job.id &&
    pending.some(
      (call) =>
        call.stage === 'result' &&
        call.target.toolName === 'run_workflow' &&
        stableStringifyJsonValue(call.target) === stableStringifyJsonValue(observation.target)
    )
      ? { workflowObservation: observation }
      : {}),
  }
}

const HISTORY_PAGE_SIZE = 40

function projectHistoryPage(messages: MastraDBMessage[], hasMore: boolean) {
  return {
    items: messages.map((message) => publicCopilotMessage(projectNativeMessage(message))),
    hasMore,
  }
}

async function readHistoryPage(
  scope: Scope,
  threadId: string,
  signal?: AbortSignal,
  cursor?: { through?: string; page: number }
) {
  await requireThread(scope, threadId, signal)
  const result = await (await getAgentMemory()).recall({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
    page: cursor?.page ?? 0,
    perPage: HISTORY_PAGE_SIZE,
    includeTotal: false,
    orderBy: { field: 'createdAt', direction: 'DESC' },
    ...(cursor?.through && { filter: { dateRange: { end: new Date(cursor.through) } } }),
  })
  signal?.throwIfAborted()
  return projectHistoryPage(
    result.messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    result.hasMore
  )
}

async function* observeThread(
  scope: Scope,
  threadId: string,
  signal: AbortSignal
): AsyncGenerator<CopilotThreadEvent> {
  const subscription = await (await getCopilotAgent()).subscribeToThread({
    ...nativeConversationIdentity(scope),
    threadId,
    withInitialHistory: { perPage: HISTORY_PAGE_SIZE },
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
              const timer = setTimeout(resolve, COPILOT_CANCELLATION_POLL_INTERVAL)
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
            history: {
              status: 'history',
              threadId,
              ...(await readHistoryPage(scope, threadId, signal)),
              ...(await projectPendingJob(scope, threadId, settled, signal)),
            },
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
            ...projectHistoryPage(part.payload.messages, part.payload.hasMore),
            ...(await projectPendingJob(scope, threadId, job, signal)),
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
  if (request.command === 'thread.page') {
    return {
      status: 'history.page',
      threadId: request.threadId,
      ...(await readHistoryPage(scope, request.threadId, signal, request)),
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
      const waiting = AbortSignal.any(
        [signal, AbortSignal.timeout(CANCELLATION_TIMEOUT)].filter(
          (item): item is AbortSignal => !!item
        )
      )
      let ownership: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
      const drainWorkflows: Array<() => Promise<void>> = []
      const run = { runId: request.runId, threadId: request.threadId, scope }
      try {
        const readJobOwnership = async () => {
          const job = await readCopilotJob(scope, request.threadId)
          const owner = await readCopilotThreadOwnership(scope, request.threadId)
          const expectedGeneration =
            job?.runId === request.runId && job.admissionGeneration === owner?.generation
              ? job.admissionGeneration
              : undefined
          return { job, owner, expectedGeneration }
        }
        if (currentRunId) {
          await cancelCopilotRunAfterWorkflows(run, async (isAdmitted) => {
            waiting.throwIfAborted()
            const pending = async () =>
              (await listCopilotPending(scope, request.threadId, waiting)).filter(
                ({ target, stage }) =>
                  target.runId === run.runId &&
                  target.toolName === 'run_workflow' &&
                  stage === 'result' &&
                  isAdmitted(target.toolCallId)
              )
            if (!ownership) {
              if (!(await pending()).length) return
              const { job, owner, expectedGeneration } = await readJobOwnership()
              if (job && job.runId !== run.runId)
                throw new NativeTargetError('Copilot cancellation target changed')
              // Studio keeps its readback generation until the effect drains.
              const liveReadback =
                job?.readbackRequestId &&
                !job.status &&
                owner?.live &&
                owner.ownerId === run.runId &&
                expectedGeneration === undefined
              if (!liveReadback)
                ownership = await claimCopilotThread(
                  scope,
                  request.threadId,
                  run.runId,
                  job?.id,
                  expectedGeneration
                )
            }
            const { cancelPendingWorkflowExecution, waitForPendingWorkflowExecutionDrain } =
              await import('@/lib/workflows/queued-execution-cancellation')
            // Keep the suspension available to Stop until every admitted workflow is accounted for.
            const cancelWorkflows = async () => {
              for (const call of await pending()) {
                const { entityId } = ToolArgSchemas.run_workflow.parse(call.originalArgs)
                const target = {
                  pendingExecutionId: nativeToolCallId(call.target),
                  userId: scope.actorUserId,
                  workflowId: entityId,
                  ...(call.context?.contextEntityKind === 'workflow' &&
                    call.context.contextEntityId === entityId &&
                    call.context.workspaceId && { workspaceId: call.context.workspaceId }),
                }
                const result = await cancelPendingWorkflowExecution(target)
                if (result.status === 'not_found')
                  throw new NativeTargetError('Workflow cancellation could not be verified', 503)
                drainWorkflows.push(() =>
                  waitForPendingWorkflowExecutionDrain(target, result, waiting)
                )
              }
            }
            if (ownership) await ownership.run(cancelWorkflows)
            else await cancelWorkflows()
            waiting.throwIfAborted()
            await ownership?.renew()
            return drainWorkflows.length > 0
          })
          await publishAbortRequest((await getMastra()).pubsub, run.runId)
        }
        const drains = await Promise.allSettled(drainWorkflows.map((drain) => drain()))
        for (const drain of drains) if (drain.status === 'rejected') throw drain.reason
        const { expectedGeneration } = await readJobOwnership()
        if (!ownership && expectedGeneration === undefined)
          await waitForCopilotRunRelease(scope, request.threadId, request.runId, waiting)
        waiting.throwIfAborted()
        if (drainWorkflows.length) await finishCopilotWorkflowCancellation(run)
        else if (currentRunId && (await readCopilotCancellation(run.runId)) === 'draining')
          throw new NativeTargetError('Workflow cancellation could not be verified', 503)
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
          ownership ??= await claimCopilotThread(
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
  let admittedRequest = request
  try {
    if (request.command === 'message') {
      if (request.threadId) await requireThread(scope, threadId, signal)
      const { validateCopilotModel } = await import('@/lib/copilot/settings.server')
      admittedRequest = {
        ...request,
        ...(await validateCopilotModel(request.model, request.reasoning)),
      }
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
      await delay(COPILOT_CANCELLATION_POLL_INTERVAL, undefined, { signal })
    }
    throw error
  }
  const job: CopilotJobState = {
    id: jobId,
    runId,
    ...(request.command === 'tool.execute' &&
    request.action === 'readback' &&
    request.target.toolName === 'run_workflow'
      ? { readbackRequestId: request.requestId }
      : {}),
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
          metadata: { copilotJob: job },
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
          request:
            admittedRequest.command === 'message'
              ? (({ input: _input, ...command }) => command)(admittedRequest)
              : admittedRequest,
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
          error: copilotFailure(error).error,
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
  await waitForCopilotRunRelease(
    scope,
    threadId,
    job.runId,
    AbortSignal.timeout(CANCELLATION_TIMEOUT)
  )
  const ownership = await claimCopilotThread(scope, threadId, job.runId, job.id)
  try {
    await ownership.run(async () => {
      const current = await readCopilotJob(scope, threadId)
      if (current?.status) return
      const cancellation = await readCopilotCancellation(job.runId)
      if (
        cancellation === 'settled' ||
        (!cancellation && !(await hasPendingWorkflowReadback(scope, threadId, current)))
      ) {
        await cancelCopilotRun({ runId: job.runId, threadId, scope })
        await deleteCopilotRunSnapshot(job.runId)
      }
      await saveCopilotJob(
        scope,
        threadId,
        job.id,
        cancellation
          ? { status: 'aborted' }
          : { status: 'failed', error: copilotFailure(new Error(message)).error }
      )
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
    return Response.json(copilotFailure(error), {
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
