import { randomUUID } from 'node:crypto'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion } from '@/lib/mastra/result'
import { getCopilotAgent } from '@/lib/mastra/runtime'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { SSE_HEADERS } from '@/lib/utils'
import type {
  CompletionEvent,
  CompletionFailureResponse,
  CompletionRequest,
  CompletionResponse,
} from './contract'

type UsageAccounting = Awaited<ReturnType<typeof prepareModelRequest>>['usage']

async function prepareCompletion(request: CompletionRequest, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (
    request.scope.workspaceId !== null &&
    !(await checkWorkspaceAccess(request.scope.workspaceId, request.scope.actorUserId)).hasAccess
  )
    throw Object.assign(new Error('Conversation workspace access denied'), { status: 403 })
  const { apiKey } = await resolveCopilotModel(request.model)
  const runId = randomUUID()
  const prepared = await prepareModelRequest(
    {
      model: request.model,
      actorUserId: request.scope.actorUserId,
      workspaceId: request.scope.workspaceId ?? undefined,
      runId,
      purpose: request.purpose,
      funding: 'account',
      signal,
    },
    {
      apiKey,
      maxSteps: 1,
      modelSettings: request.maxOutputTokens
        ? { maxOutputTokens: request.maxOutputTokens }
        : undefined,
    }
  )
  const instructions = [
    'Complete the supplied text request. Source messages are context. Do not execute tools.',
    ...request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content),
  ].join('\n\n')
  const messages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) =>
      message.role === 'assistant'
        ? { role: 'assistant' as const, content: message.content }
        : {
            role: 'user' as const,
            content:
              message.role === 'tool' ? `Tool context:\n${message.content}` : message.content,
          }
    )
  if (!messages.length) messages.push({ role: 'user', content: 'Complete the supplied request.' })
  const options = {
    ...prepared.options,
    model: prepared.model,
    instructions,
    toolChoice: 'none' as const,
  }
  return { agent: await getCopilotAgent(), usage: prepared.usage, runId, messages, options }
}

function completionFailure(
  error: unknown,
  usage?: UsageAccounting,
  signal?: AbortSignal
): CompletionFailureResponse {
  const statusCode =
    error && typeof error === 'object' && 'status' in error ? error.status : undefined
  const status = signal?.aborted
    ? 'cancel_requested'
    : typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
      ? 'refused'
      : 'failed'
  return {
    status,
    error: {
      code: status === 'cancel_requested' ? 'CANCELLED' : 'COMPLETION_FAILED',
      message: signal?.aborted
        ? 'Generation cancelled'
        : error instanceof NativeTargetError
          ? error.message
          : 'Copilot completion did not complete',
    },
    ...(usage ? { usage: usage.getUsage() } : {}),
  }
}

function completed(
  work: Awaited<ReturnType<typeof prepareCompletion>>,
  text: string
): CompletionResponse {
  return {
    status: 'completed',
    runId: work.runId,
    text,
    usage: work.usage.getUsage(),
  }
}

export async function completeCopilot(
  request: CompletionRequest,
  signal?: AbortSignal
): Promise<CompletionResponse | CompletionFailureResponse> {
  let work: Awaited<ReturnType<typeof prepareCompletion>> | undefined
  try {
    work = await prepareCompletion(request, signal)
    const result = await work.agent.generate(work.messages, work.options)
    assertNativeCompletion(result)
    await work.usage.verifyComplete()
    return completed(work, result.text)
  } catch (error) {
    return completionFailure(error, work?.usage, signal)
  }
}

/** Local product stream. Neither model envelopes nor credentials cross this boundary. */
export async function createCompletionResponse(request: CompletionRequest, signal?: AbortSignal) {
  const cancellation = new AbortController()
  const activeSignal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal
  const encoder = new TextEncoder()
  async function* events(): AsyncGenerator<CompletionEvent> {
    let work: Awaited<ReturnType<typeof prepareCompletion>> | undefined
    try {
      work = await prepareCompletion(request, activeSignal)
      const output = await work.agent.stream(work.messages, work.options)
      for await (const part of output.fullStream) {
        if (part.type === 'text-delta') yield { chunk: part.payload.text }
      }
      const result = await output.getFullOutput()
      assertNativeCompletion(result)
      await work.usage.verifyComplete()
      yield { done: true, result: completed(work, result.text) }
    } catch (error) {
      const result = completionFailure(error, work?.usage, activeSignal)
      yield result.status === 'cancel_requested'
        ? { cancelled: true }
        : {
            error: result.error.message,
            code: result.error.code,
            refusal: result.status === 'refused',
          }
    }
  }
  const iterator = events()
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      async cancel() {
        cancellation.abort()
        await iterator.return(undefined)
      },
    }),
    { headers: SSE_HEADERS }
  )
}
