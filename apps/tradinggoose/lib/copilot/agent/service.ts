import { setTimeout as delay } from 'node:timers/promises'
import type { AgentExecutionOptions } from '@mastra/core/agent'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { InputProcessor } from '@mastra/core/processors'
import type { ChunkType } from '@mastra/core/stream'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { validateNativeBrowserAssertion } from '@/lib/copilot/native/browser-assertion'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import {
  COPILOT_CONTEXT_PART,
  type CopilotEvent,
  type CopilotOutputEvent,
  type CopilotRequest,
  type CopilotResponse,
  type CopilotThreadEvent,
  type CopilotToolContext,
  type ErrorResponse,
  type Json,
  type Pending,
  type Scope,
} from '@/lib/copilot/native/contract'
import { readNativeThread, readNativeThreadHistory } from '@/lib/copilot/native/history'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { readbackNativeToolResult } from '@/lib/copilot/native/readback'
import {
  authorizeNativeConversationScope,
  NativeTargetError,
  resolveNativePendingTarget,
  type ServerPending,
} from '@/lib/copilot/native/target'
import { processContextsServer } from '@/lib/copilot/process-contents'
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { projectNativeMessage } from '@/lib/mastra/messages'
import { assertNativeToolArguments } from '@/lib/mastra/options'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion, getNativeFinalText } from '@/lib/mastra/result'
import { getAgentMemory, getCopilotAgent, getNativeMemoryStore } from '@/lib/mastra/runtime'
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
  type CopilotRun,
  cancelCopilotRun,
  claimCopilotThread,
  deleteCopilotThread,
  isCopilotRunCancelled,
  readCopilotThreadRun,
  releaseCopilotThread,
  resumeCopilotThread,
  suspendCopilotThread,
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
      let args = call.requiresApproval ? call.args : payload!.originalArgs
      assertNativeToolArguments(args)
      if (typeof args === 'string') args = JSON.parse(args)
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

function failure(error: unknown): ErrorResponse {
  const status = error instanceof NativeTargetError ? error.status : 503
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
      message:
        error instanceof NativeTargetError ? error.message : 'Copilot generation did not complete',
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
  while ((await readCopilotThreadRun(scope, threadId)) === runId) {
    signal.throwIfAborted()
    await delay(CANCELLATION_POLL_INTERVAL, undefined, { signal })
  }
  signal.throwIfAborted()
}

async function* observeThread(
  scope: Scope,
  threadId: string,
  signal: AbortSignal
): AsyncGenerator<CopilotThreadEvent> {
  const agent = await getCopilotAgent()
  const subscription = await agent.subscribeToThread({
    ...nativeConversationIdentity(scope),
    threadId,
    withInitialHistory: { perPage: Number.MAX_SAFE_INTEGER },
    withRunStatus: true,
  })
  const detach = () => subscription.unsubscribe()
  signal.addEventListener('abort', detach, { once: true })
  try {
    if (signal.aborted) return
    for await (const part of subscription.stream) {
      if (signal.aborted) return
      if (
        part.type === 'error' ||
        (part.type === 'thread-run-status' && part.payload.status !== 'suspended')
      ) {
        try {
          // Native abort and lease loss can precede running tools draining. Only
          // the producer releases Studio's claim after writes and accounting settle.
          await waitForRunRelease(
            scope,
            threadId,
            part.runId,
            AbortSignal.any([signal, AbortSignal.timeout(CANCELLATION_TIMEOUT)])
          )
        } catch {
          if (signal.aborted) return
          yield {
            type: 'thread.error',
            runId: part.runId,
            error: {
              code: 'STREAM_INTERRUPTED',
              message: 'The response outcome could not be confirmed. Saved history is preserved.',
            },
          }
          continue
        }
      }
      if (part.type === 'thread-history') {
        const pending = (await listCopilotPending(scope, threadId, signal)).map(publicPending)
        const claimedRunId = await readCopilotThreadRun(scope, threadId)
        yield {
          type: 'thread.history',
          result: {
            status: 'history',
            threadId,
            items: part.payload.messages.map(projectNativeMessage),
            pending,
          },
          activeRunId: part.payload.activeRunId,
          ...(!part.payload.activeRunId && !pending.length && claimedRunId
            ? { interruptedRunId: claimedRunId }
            : {}),
        }
      } else if (part.type === 'thread-run-status') {
        yield { type: 'thread.status', runId: part.runId, status: part.payload.status }
      } else if (
        part.type === 'start' ||
        (part.type === 'step-start' && typeof part.payload.messageId === 'string')
      ) {
        if (typeof part.payload.messageId !== 'string')
          throw new Error('Native response is missing its assistant message ID')
        yield {
          type: 'thread.started',
          runId: part.runId,
          messageId: part.payload.messageId,
        }
      } else if (part.type === 'error') {
        yield {
          type: 'thread.error',
          runId: part.runId,
          error: {
            code: 'STREAM_INTERRUPTED',
            message: 'The response was interrupted. Saved history and usage are preserved.',
          },
        }
      } else {
        const event = projectChunk(part)
        if (event) yield { type: 'thread.output', runId: part.runId, event }
      }
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
  if (request.command === 'history.read')
    return {
      status: 'history',
      threadId: request.threadId,
      items: await readNativeThreadHistory(scope, request.threadId, signal),
      pending: (await listCopilotPending(scope, request.threadId, signal)).map(publicPending),
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
      try {
        await waitForRunRelease(scope, request.threadId, request.runId, waiting)
      } catch (error) {
        signal?.throwIfAborted()
        if (!waiting.aborted) throw error
        throw new NativeTargetError(
          'Copilot cancellation has not finished. Try stopping it again.',
          503
        )
      }
      return { status: 'cancel_requested', runId: request.runId }
    }
  }
}

function inputMessage(
  request: Extract<CopilotRequest, { command: 'message' }>,
  run: CopilotRun
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
  for (const attachment of request.input.attachments ?? [])
    parts.push({ type: 'text', text: `${attachment.name}\n${attachment.text}` })
  if (request.input.contexts?.length)
    parts.push({ type: COPILOT_CONTEXT_PART, data: request.input.contexts })
  return {
    id: request.messageId ?? crypto.randomUUID(),
    role: 'user',
    threadId: run.threadId,
    resourceId: nativeConversationIdentity(run.scope).resourceId,
    createdAt: new Date(),
    content: { format: 2, parts },
  }
}

async function* generate(
  request: CopilotRequest,
  scope: Scope,
  cancellation: AbortController,
  toolContexts: CopilotToolContext[]
): AsyncGenerator<CopilotEvent> {
  let run: CopilotRun | undefined
  let watcher: ReturnType<typeof setInterval> | undefined
  let suspended = false
  let usage: Awaited<ReturnType<typeof prepareModelRequest>>['usage'] | undefined
  let ownsThread = false
  let nativeStarted = false
  let nativeOutput: { getFullOutput(): Promise<{ finishReason?: string }> } | undefined
  let requestContext: ReturnType<typeof createCopilotRequestContext> | undefined
  let drained = false
  let finalization: Promise<void> | undefined
  const finalize = () =>
    (finalization ??= (async () => {
      if (cancellation.signal.aborted && run && !drained) {
        try {
          await cancelCopilotRun(run)
        } catch {
          ownsThread = false // Keep the claim when durable cancellation cannot be confirmed.
        }
      }
      // Closing the HTTP observer does not stop the native writer. Keep ownership until it settles.
      if (nativeOutput && !drained) {
        try {
          const result = await nativeOutput.getFullOutput()
          drained = true
          suspended = result.finishReason === 'suspended'
        } catch {
          // An unknown native outcome must keep the claim, rather than admit a competing writer.
        }
      }
      // Mastra can stop waiting for an aborted tool before its execute promise settles.
      if (requestContext) await Promise.all(getCopilotExecution(requestContext)!.pendingTools)
      if (watcher) clearInterval(watcher)
      if (run && ownsThread && (!nativeStarted || drained)) {
        if (suspended) await suspendCopilotThread(run.scope, run.threadId, run.runId)
        else await releaseCopilotThread(run.scope, run.threadId, run.runId)
      }
    })())
  try {
    const agent = await getCopilotAgent()
    const signal = cancellation.signal
    let pending: ServerPending | undefined
    let decision: CopilotDecision | undefined
    let apiKey: string | undefined
    if (request.command === 'message') {
      if (request.messageId && !request.threadId)
        throw new NativeTargetError('Editing a message requires its conversation', 422)
      apiKey = (await resolveCopilotModel(request.model)).apiKey
      const threadId = request.threadId ?? crypto.randomUUID()
      if (request.threadId) await requireThread(scope, threadId, signal)
      const runId = crypto.randomUUID()
      await claimCopilotThread(scope, threadId, runId)
      ownsThread = true
      try {
        run = {
          runId,
          threadId,
          scope: scope,
          model: request.model,
          accessLevel: request.accessLevel ?? 'limited',
          toolContext: request.toolContext,
          toolContexts,
          workflowId: request.workflowId,
        }
        if (!request.threadId)
          await (await getAgentMemory()).createThread({
            threadId,
            resourceId: nativeConversationIdentity(scope).resourceId,
            title: '',
            metadata: { product: 'copilot' },
          })
      } catch (error) {
        await releaseCopilotThread(scope, threadId, runId)
        ownsThread = false
        throw error
      }
    } else if ('target' in request) {
      pending = await resolveNativePendingTarget(
        scope,
        request.target,
        request.command === 'tool.approve' || request.command === 'tool.decline'
          ? 'approval'
          : 'result',
        signal
      )
      suspended = true
      run = await readCopilotRun(scope, pending.target.threadId, pending.target.runId)
      await assertCopilotRunActive(run.runId)
      apiKey = (await resolveCopilotModel(run.model)).apiKey
      await authorizeNativeBusinessResult(scope, pending)
      if (request.command === 'tool.result') {
        validateNativeBrowserAssertion(pending, request.assertion)
        decision = {
          action: 'result',
          result:
            request.assertion.kind === 'ui.opened'
              ? {
                  message:
                    'The requested Studio dialog was opened. User completion is still required.',
                  ...(pending.target.toolName === 'deploy_workflow' ? { openedModal: true } : {}),
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
    let checking = false
    watcher = setInterval(() => {
      if (checking) return
      checking = true
      void assertCopilotRunActive(run!.runId)
        .catch((error) => cancellation.abort(error))
        .finally(() => {
          checking = false
        })
    }, CANCELLATION_POLL_INTERVAL)
    const prepared = await prepareModelRequest(
      {
        model: run.model,
        actorUserId: run.scope.actorUserId,
        workspaceId: run.scope.workspaceId ?? undefined,
        workflowId: run.workflowId,
        runId: run.runId,
        purpose: 'copilot',
        funding: 'account',
        signal,
      },
      { apiKey, maxSteps: 50 }
    )
    usage = prepared.usage
    const message = request.command === 'message' ? inputMessage(request, run) : undefined
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
    if (request.command === 'message' && request.messageId) {
      const store = await getNativeMemoryStore()
      const history = await store.listMessages({
        threadId: run.threadId,
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
        typeof request.input.content !== 'string' ||
        request.input.attachments?.length
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
      if (
        history.messages
          .slice(index + 1)
          .some((item) => item.content.parts.some((part) => part.type === 'tool-invocation'))
      )
        throw new NativeTargetError(
          'Start a new message after tool activity to preserve its history',
          409
        )
      signal.throwIfAborted()
      message!.createdAt = original.createdAt
      await store.saveMessages({ messages: [message!] })
      await store.deleteMessages(history.messages.slice(index + 1).map((item) => item.id))
    }
    requestContext = createCopilotRequestContext({
      run,
      model: prepared.model,
      signal,
      pending,
      decision,
    })
    const guard: InputProcessor = {
      id: 'studio-copilot-authorization',
      async processInputStep() {
        await requireThread(run!.scope, run!.threadId, signal)
        await assertCopilotRunActive(run!.runId)
        signal.throwIfAborted()
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
    if (pending) {
      await resumeCopilotThread(run.scope, run.threadId, run.runId)
      ownsThread = true
      await assertCopilotRunActive(run.runId)
    }
    signal.throwIfAborted()
    nativeStarted = true
    suspended = false
    const output = (nativeOutput =
      request.command === 'message'
        ? await agent.stream([message!], options)
        : request.command === 'tool.approve'
          ? await agent.approveToolCall({
              ...options,
              runId: run.runId,
              toolCallId: pending!.target.toolCallId,
            })
          : request.command === 'tool.decline'
            ? await agent.declineToolCall({
                ...options,
                runId: run.runId,
                toolCallId: pending!.target.toolCallId,
                reason: request.reason,
              })
            : await agent.resumeStream(decision, {
                ...options,
                toolCallId: pending!.target.toolCallId,
              }))
    ownsThread = true
    yield {
      type: 'response.started',
      runId: run.runId,
      threadId: run.threadId,
      ...(message ? { messageId: message.id } : {}),
    }
    let streamError: unknown
    for await (const part of output.fullStream) {
      if (part.type === 'error') streamError = part.payload.error
      if (signal.aborted) continue
      const event = projectChunk(part)
      if (event) yield event
    }
    const result = await output.getFullOutput()
    drained = true
    suspended = result.finishReason === 'suspended'
    signal.throwIfAborted()
    if (streamError || result.error) throw streamError ?? result.error
    const items = await listCopilotPending(run.scope, run.threadId, signal)
    if (request.command === 'message' || result.finishReason !== 'suspended')
      await usage.verifyComplete()
    if (items.length) {
      yield {
        type: 'response.suspended',
        result: {
          status: 'suspended',
          threadId: run.threadId,
          runId: run.runId,
          text: result.text,
          pending: items.map(publicPending),
          usage: usage.getUsage(),
        },
      }
    } else {
      assertNativeCompletion(result)
      getNativeFinalText(result)
      yield {
        type: 'response.completed',
        result: {
          status: 'completed',
          threadId: run.threadId,
          runId: run.runId,
          text: result.text,
          usage: usage.getUsage(),
        },
      }
    }
  } catch (error) {
    if (cancellation.signal.aborted && run) {
      await finalize()
      const owner = await readCopilotThreadRun(run.scope, run.threadId)
      if (owner)
        yield {
          type: 'response.error',
          result: failure(new NativeTargetError('Copilot cancellation has not finished', 503)),
        }
      else
        yield {
          type: 'response.cancel_requested',
          result: { status: 'cancel_requested', runId: run.runId },
        }
    } else {
      const result = failure(error)
      if (usage) result.usage = usage.getUsage()
      yield {
        type: result.status === 'refused' ? 'response.refused' : 'response.error',
        result,
      }
    }
  } finally {
    await finalize()
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
  } catch (error) {
    return Response.json(failure(error), {
      status: error instanceof NativeTargetError ? error.status : 503,
    })
  }
  signal?.throwIfAborted()
  const observing = request.command === 'thread.observe'
  const cancellation = new AbortController()
  const events = observing
    ? observeThread(scope, request.threadId, cancellation.signal)
    : generate(request, scope, cancellation, toolContexts)
  const encoder = new TextEncoder()
  let detached = false
  let accepted = false
  const detach = () => {
    detached = true
    // Before acceptance, Stop has no run ID and must cancel the request's preflight.
    // Once accepted, closing an observer leaves the model/tool writer running.
    if (observing || !accepted) cancellation.abort()
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
            if (event.type === 'response.started') accepted = true
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
