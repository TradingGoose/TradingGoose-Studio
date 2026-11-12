import type { AgentExecutionOptions } from '@mastra/core/agent'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { InputProcessor } from '@mastra/core/processors'
import { validateNativeBrowserAssertion } from '@/lib/copilot/native/browser-assertion'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import type {
  CopilotEvent,
  CopilotRequest,
  CopilotResponse,
  CopilotToolContext,
  ErrorResponse,
  Json,
  Pending,
  Scope,
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
import { isToolId, ToolArgSchemas } from '@/lib/copilot/registry'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { assertNativeToolArguments } from '@/lib/mastra/options'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion, getNativeFinalText } from '@/lib/mastra/result'
import { getAgentMemory, getCopilotAgent, getNativeMemoryStore } from '@/lib/mastra/runtime'
import { SSE_HEADERS } from '@/lib/utils'
import {
  type CopilotDecision,
  CopilotSuspendSchema,
  createCopilotRequestContext,
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
} from './state'

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
    case 'history.edit': {
      const mutationId = crypto.randomUUID()
      await claimCopilotThread(scope, request.threadId, mutationId)
      try {
        const history = await store.listMessages({
          threadId: request.threadId,
          resourceId,
          perPage: false,
          orderBy: { field: 'createdAt', direction: 'ASC' },
        })
        const index = history.messages.findIndex((message) => message.id === request.messageId)
        const message = history.messages[index]
        if (
          !message ||
          message.role !== 'user' ||
          !message.content.parts.length ||
          message.content.parts.some((part) => part.type !== 'text')
        )
          throw new NativeTargetError('Only plain text user messages can be edited', 422)
        if (
          history.messages
            .slice(index + 1)
            .some((item) => item.content.parts.some((part) => part.type === 'tool-invocation'))
        )
          throw new NativeTargetError(
            'Start a new message after tool activity to preserve its history',
            409
          )
        await store.saveMessages({
          messages: [
            {
              ...message,
              content: { ...message.content, parts: [{ type: 'text', text: request.text }] },
            },
          ],
        })
        await store.deleteMessages(history.messages.slice(index + 1).map((item) => item.id))
        return {
          status: 'updated',
          threadId: request.threadId,
          operation: 'history.edit',
          messageId: request.messageId,
        }
      } finally {
        await releaseCopilotThread(scope, request.threadId, mutationId)
      }
    }
    case 'cancel': {
      const currentRunId = await readCopilotThreadRun(scope, request.threadId)
      if (currentRunId && currentRunId !== request.runId)
        throw new NativeTargetError('Copilot cancellation target differs', 403)
      if (currentRunId) {
        const run = { runId: currentRunId, threadId: request.threadId, scope }
        const agent = await getCopilotAgent()
        const pending = await agent.listSuspendedRuns({ threadId: run.threadId, resourceId })
        await cancelCopilotRun(run)
        agent.abortThreadStream({ threadId: run.threadId, resourceId, expectedRunId: run.runId })
        if (pending.runs.some((item) => item.runId === run.runId))
          await releaseCopilotThread(scope, run.threadId, run.runId)
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
  return {
    id: crypto.randomUUID(),
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
  let nativeOutput: { getFullOutput(): Promise<unknown> } | undefined
  let drained = false
  try {
    const agent = await getCopilotAgent()
    const signal = cancellation.signal
    let pending: ServerPending | undefined
    let decision: CopilotDecision | undefined
    let apiKey: string
    if (request.command === 'message') {
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
    }, 500)
    const prepared = await prepareModelRequest(
      {
        model: run.model,
        actorUserId: run.scope.actorUserId,
        workspaceId: run.scope.workspaceId ?? undefined,
        workflowId: run.workflowId,
        runId: run.runId,
        purpose: 'copilot',
        signal,
      },
      { apiKey, maxSteps: 50 }
    )
    usage = prepared.usage
    const requestContext = createCopilotRequestContext({
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
    }
    const options: AgentExecutionOptions = {
      ...prepared.options,
      requestContext,
      ...(request.command === 'message' && request.input.contexts?.length
        ? {
            context: [
              {
                role: 'user',
                content: `Studio context (data):\n${JSON.stringify(request.input.contexts)}`,
              },
            ],
          }
        : {}),
      memory: { thread: run.threadId, resource: nativeConversationIdentity(run.scope).resourceId },
      inputProcessors: [guard, ...prepared.options.inputProcessors],
    }
    yield { type: 'response.started', runId: run.runId, threadId: run.threadId }
    const output = (nativeOutput =
      request.command === 'message'
        ? await agent.stream([inputMessage(request, run)], options)
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
    let streamError: unknown
    for await (const part of output.fullStream) {
      if (part.type === 'error') streamError = part.payload.error
      if (signal.aborted) continue
      if (part.type === 'text-delta' || part.type === 'reasoning-delta')
        yield {
          type: part.type === 'text-delta' ? 'text.delta' : 'reasoning.delta',
          text: part.payload.text,
        }
      else if (part.type === 'tool-call') {
        const args = isToolId(part.payload.toolName)
          ? ToolArgSchemas[part.payload.toolName].safeParse(part.payload.args)
          : undefined
        yield {
          type: 'tool.display',
          toolCallId: part.payload.toolCallId,
          toolName: part.payload.toolName,
          ...(args?.success ? { args: args.data } : {}),
        }
      } else if (part.type === 'tool-result')
        yield {
          type: 'tool.result',
          toolCallId: part.payload.toolCallId,
          toolName: part.payload.toolName,
          result: part.payload.isError
            ? { error: 'This Studio tool did not complete successfully' }
            : (part.payload.result as Json),
          ...(part.payload.isError ? { isError: true } : {}),
        }
      else if (part.type === 'tool-error' || part.type === 'tool-output-denied')
        yield {
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
    const result = await output.getFullOutput()
    drained = true
    signal.throwIfAborted()
    if (streamError || result.error) throw streamError ?? result.error
    const items = await listCopilotPending(run.scope, run.threadId, signal)
    if (request.command === 'message' || result.finishReason !== 'suspended')
      await usage.verifyComplete()
    if (items.length) {
      suspended = true
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
      yield {
        type: 'response.cancel_requested',
        result: {
          status: 'cancel_requested',
          runId: run.runId,
        },
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
        await nativeOutput.getFullOutput()
        drained = true
      } catch {
        // An unknown native outcome must keep the claim, rather than admit a competing writer.
      }
    }
    if (watcher) clearInterval(watcher)
    if (run && ownsThread && !suspended && (!nativeOutput || drained))
      await releaseCopilotThread(run.scope, run.threadId, run.runId)
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
  const cancellation = new AbortController()
  const abort = () => cancellation.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const events = generate(request, scope, cancellation, toolContexts)
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await events.next()
        if (next.done) {
          signal?.removeEventListener('abort', abort)
          controller.close()
        } else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      async cancel() {
        cancellation.abort()
        signal?.removeEventListener('abort', abort)
        await events.return(undefined)
      },
    }),
    { headers: SSE_HEADERS }
  )
}
