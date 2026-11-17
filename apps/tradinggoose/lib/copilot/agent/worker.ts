import type { AgentExecutionOptions } from '@mastra/core/agent'
import { ModelRouterLanguageModel } from '@mastra/core/llm'
import type { InputProcessor } from '@mastra/core/processors'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { COPILOT_CONTEXT_PART, type Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import type { PendingExecutionPayload } from '@/lib/execution/pending-execution'
import { prepareNativeModelRequest } from '@/lib/mastra/native-request'
import { getNativeFinalText } from '@/lib/mastra/result'
import { getCopilotAgent, getNativeMemoryStore } from '@/lib/mastra/runtime'
import { createCopilotRequestContext, getCopilotExecution } from './context'
import { copilotFailure } from './errors'
import {
  type CopilotJobState,
  type CopilotRun,
  claimCopilotThread,
  deleteCopilotRunSnapshot,
  readCopilotJob,
  saveCopilotJob,
  waitForCopilotRunRelease,
} from './ownership'
import { createCopilotWorkerClient } from './worker-client'
import { COPILOT_CANCELLATION_POLL_INTERVAL, CopilotJobSchema } from './worker-contract'

export async function finalizeCopilotExecution(value: PendingExecutionPayload, message: string) {
  await createCopilotWorkerClient(CopilotJobSchema.parse(value)).call('finalize', { message })
}

export async function executeCopilotJob(value: PendingExecutionPayload, abortSignal?: AbortSignal) {
  const job = CopilotJobSchema.parse(value)
  const { request, actorUserId, threadId, runId, jobId, messageId } = job
  const studio = createCopilotWorkerClient(job)
  const scope: Scope = { actorUserId, workspaceId: request.workspaceId }
  const cancellation = new AbortController()
  const abort = () => cancellation.abort(abortSignal?.reason)
  abortSignal?.addEventListener('abort', abort, { once: true })
  if (abortSignal?.aborted) abort()
  let outcome: Pick<CopilotJobState, 'status' | 'error'> = { status: 'failed' }
  let run: CopilotRun | undefined
  let apiKey: string | undefined
  let watcher: ReturnType<typeof setInterval> | undefined
  let ownership: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
  let nativeStarted = false
  let nativeOutput: { getFullOutput(): Promise<{ finishReason?: string }> } | undefined
  let requestContext: ReturnType<typeof createCopilotRequestContext> | undefined
  let cancellationRequest: Promise<void> | undefined
  const publishCancellation = () => {
    if (ownership!.signal.aborted) return
    cancellationRequest = studio.call('cancel', {})
    // Retain the failure for cleanup without rejecting while native tools are still draining.
    void cancellationRequest.catch(() => undefined)
  }
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
      await waitForCopilotRunRelease(scope, threadId, runId, cancellation.signal)
    ownership = await claimCopilotThread(scope, threadId, runId, jobId, admissionGeneration)
    cancellation.signal.addEventListener('abort', publishCancellation, { once: true })
    if (cancellation.signal.aborted) publishCancellation()
    ownership.signal.addEventListener('abort', () => cancellation.abort(ownership!.signal.reason), {
      once: true,
    })
    let checking = false
    watcher = setInterval(() => {
      if (checking) return
      checking = true
      void studio
        .call('active', { fence: ownership!.fence })
        .catch((error) => cancellation.abort(error))
        .finally(() => {
          checking = false
        })
    }, COPILOT_CANCELLATION_POLL_INTERVAL)
    const signal = cancellation.signal
    const preparedRun = await studio.call('prepare', { fence: ownership.fence }, signal)
    run = preparedRun.run
    const { pending, decision, contexts } = preparedRun
    apiKey = preparedRun.model.apiKey
    const agent = await getCopilotAgent()
    const prepared = await prepareNativeModelRequest(
      {
        actorUserId: run.scope.actorUserId,
        workspaceId: run.scope.workspaceId,
        runId: run.runId,
        funding: 'account',
        signal,
      },
      {
        model: new ModelRouterLanguageModel(preparedRun.model),
        providerOptions: run.providerOptions,
        maxSteps: 50,
        accounting: {
          assertAllowed: () => studio.call('usage.allow', { fence: ownership!.fence }, signal),
          // The native thread claim already owns Copilot attempts; no workflow log admission.
          begin: async () => false,
          // Completed usage must settle even after cancellation; do not abort this callback.
          record: (usage, providerMetadata, attemptId) =>
            studio.call('usage.record', {
              usage,
              providerMetadata,
              attemptId,
            }),
        },
      }
    )
    const message =
      request.command === 'message'
        ? (await (await getNativeMemoryStore()).listMessagesById({ messageIds: [messageId!] }))
            .messages[0]
        : undefined
    if (request.command === 'message' && !message)
      throw new NativeTargetError('Submitted Copilot message is unavailable', 409)
    requestContext = createCopilotRequestContext({
      run,
      model: prepared.model,
      signal,
      pending,
      decision,
      assertOwnership,
      // Drain a dispatched Studio effect before acknowledging cancellation.
      executeTool: (toolName, args, toolCallId) =>
        studio.call('tool', {
          run: run!,
          pending,
          decision,
          toolName,
          args,
          toolCallId,
          fence: ownership!.fence,
        }),
    })
    const guard: InputProcessor = {
      id: 'studio-copilot-ownership',
      processInputStep: assertOwnership,
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
    await studio.call('active', { fence: ownership!.fence }, signal)
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
    const { runs } = await agent.listSuspendedRuns({
      threadId: run.threadId,
      resourceId: nativeConversationIdentity(run.scope).resourceId,
    })
    if (runs.some((item) => item.runId === run!.runId)) {
      if (request.command === 'message' || result.finishReason !== 'suspended')
        await prepared.usage.verifyComplete()
      outcome = { status: 'suspended' }
    } else {
      await prepared.complete(result)
      getNativeFinalText(result)
      outcome = { status: 'success' }
    }
  } catch (error) {
    outcome = cancellation.signal.aborted
      ? { status: 'aborted' }
      : { status: 'failed', error: copilotFailure(error, apiKey).error }
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
      await cancellationRequest
      if (ownership && run && cancellation.signal.aborted && !ownership.signal.aborted) {
        await ownership.renew()
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
        cancellation.signal.removeEventListener('abort', publishCancellation)
        abortSignal?.removeEventListener('abort', abort)
      }
    }
  }
}
