import { randomUUID } from 'node:crypto'
import type { AgentExecutionOptions } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { safeInferenceError } from '@/lib/mastra/errors'
import { financialProcessors } from '@/lib/mastra/financial-processors'
import { trustedPrepareStep } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { assertNativeCompletion } from '@/lib/mastra/result'
import { getCopilotAgent } from '@/lib/mastra/runtime'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { SSE_HEADERS } from '@/lib/utils'
import {
  type CompletionEvent,
  type CompletionFailureResponse,
  type CompletionRequest,
  type CompletionResponse,
  parseNativeContract,
} from './contract'

type Finance = Awaited<ReturnType<typeof financialProcessors>>

async function prepareCompletion(request: CompletionRequest, signal?: AbortSignal) {
  signal?.throwIfAborted()
  await parseNativeContract('CompletionRequest', request)
  if (
    request.scope.workspaceId !== null &&
    !(await checkWorkspaceAccess(request.scope.workspaceId, request.scope.actorUserId)).hasAccess
  )
    throw Object.assign(new Error('Conversation workspace access denied'), { status: 403 })
  assertListedModel(request.model)
  const runId = randomUUID()
  const finance = await financialProcessors({
    actorUserId: request.scope.actorUserId,
    workspaceId: request.scope.workspaceId ?? undefined,
    runId,
    purpose: request.purpose,
    signal,
  })
  const model = createConfiguredLanguageModel(request.model)
  const requestContext = new RequestContext()
  requestContext.set('copilot-purpose', request.purpose)
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
    runId,
    requestContext,
    model,
    instructions,
    maxSteps: 1,
    toolChoice: 'none',
    abortSignal: signal,
    modelSettings: {
      maxRetries: 0,
      ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
    },
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
    prepareStep: trustedPrepareStep(model),
  } satisfies AgentExecutionOptions & { model: typeof model }
  return { agent: await getCopilotAgent(), finance, runId, messages, options }
}

function completionFailure(
  requestId: string,
  error: unknown,
  finance?: Finance,
  signal?: AbortSignal
): CompletionFailureResponse {
  const financial = finance?.getFinancialFact()
  const uncertain = !financial && finance?.getLastOccurrence() !== undefined
  const statusCode =
    error && typeof error === 'object' && 'status' in error ? error.status : undefined
  const status = signal?.aborted
    ? 'cancel_requested'
    : typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
      ? 'refused'
      : 'failed'
  return {
    requestId,
    status,
    error: {
      code: status === 'cancel_requested' ? 'CANCELLED' : 'COMPLETION_FAILED',
      message: signal?.aborted ? 'Generation cancelled' : safeInferenceError(error),
      retryable: false,
      uncertain,
    },
    uncertain,
    financialDisposition: financial ? 'accepted' : uncertain ? 'uncertain' : 'not_contacted',
    ...(financial ? { financial } : {}),
    ...(finance ? { usage: finance.getUsage() } : {}),
  }
}

function completed(
  requestId: string,
  work: Awaited<ReturnType<typeof prepareCompletion>>,
  text: string
): CompletionResponse {
  const financial = work.finance.getFinancialFact()
  if (!financial) throw new Error('Completion has no acknowledged financial acceptance')
  return {
    requestId,
    status: 'completed',
    runId: work.runId,
    text,
    financial,
    usage: work.finance.getUsage(),
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
    await work.finance.verifyComplete()
    return completed(request.requestId, work, result.text)
  } catch (error) {
    return completionFailure(request.requestId, error, work?.finance, signal)
  }
}

/** Local product stream. Neither model envelopes nor credentials cross this boundary. */
export async function createCompletionResponse(request: CompletionRequest, signal?: AbortSignal) {
  if (!request.stream) {
    const result = await completeCopilot(request, signal)
    return Response.json(result, {
      status: result.status === 'completed' ? 200 : result.status === 'refused' ? 403 : 503,
    })
  }
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
      await work.finance.verifyComplete()
      yield { done: true, result: completed(request.requestId, work, result.text) }
    } catch (error) {
      const result = completionFailure(request.requestId, error, work?.finance, activeSignal)
      const facts = {
        uncertain: result.uncertain,
        financialDisposition: result.financialDisposition,
        ...(result.financial ? { financial: result.financial } : {}),
      }
      yield result.status === 'cancel_requested'
        ? { cancelled: true, ...facts }
        : {
            error: result.error.message,
            code: result.error.code,
            refusal: result.status === 'refused',
            ...facts,
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
