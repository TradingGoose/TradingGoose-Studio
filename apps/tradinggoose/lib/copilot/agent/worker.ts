import type { AgentExecutionOptions } from '@mastra/core/agent'
import { publishAbortRequest } from '@mastra/core/agent/durable'
import type { InputProcessor } from '@mastra/core/processors'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { COPILOT_CONTEXT_PART, type Scope, type Target } from '@/lib/copilot/native/contract'
import { CopilotRunCancelled, NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import type { PendingExecutionPayload } from '@/lib/execution/pending-execution'
import { prepareNativeModelRequest } from '@/lib/mastra/native-request'
import { getNativeFinalText } from '@/lib/mastra/result'
import { getCopilotAgent, getMastra, getNativeMemoryStore } from '@/lib/mastra/runtime'
import { createCopilotRequestContext, getCopilotExecution } from './context'
import { copilotFailure } from './errors'
import {
  type CopilotJobState,
  type CopilotRun,
  claimCopilotThread,
  deleteCopilotRunSnapshot,
  hasPendingWorkflowReadback,
  readCopilotJob,
  saveCopilotJob,
  waitForCopilotRunRelease,
} from './ownership'
import { createCopilotWorkerClient } from './worker-client'
import {
  CopilotJobSchema,
  CopilotSuspendSchema,
  type CopilotWorkerToolInput,
  type CopilotWorkerToolResult,
} from './worker-contract'

function isStudioDispatch(suspendPayload: unknown) {
  return CopilotSuspendSchema.parse(suspendPayload).studioDispatch === true
}

export async function finalizeCopilotExecution(
  value: PendingExecutionPayload,
  message: string,
  mode: 'trigger' | 'local' = 'trigger'
) {
  await createCopilotWorkerClient(CopilotJobSchema.parse(value), mode).call('finalize', { message })
}

export async function executeCopilotJob(
  value: PendingExecutionPayload,
  abortSignal?: AbortSignal,
  mode: 'trigger' | 'local' = 'trigger'
) {
  const job = CopilotJobSchema.parse(value)
  const { request, actorUserId, threadId, runId, jobId, messageId } = job
  const studio = createCopilotWorkerClient(job, mode)
  const scope: Scope = { actorUserId, workspaceId: request.workspaceId }
  const cancellation = new AbortController()
  const abort = () => cancellation.abort(abortSignal?.reason)
  abortSignal?.addEventListener('abort', abort, { once: true })
  if (abortSignal?.aborted) abort()
  let outcome: Pick<CopilotJobState, 'status' | 'error' | 'workflowObservation'> = {
    status: 'failed',
  }
  let run: CopilotRun | undefined
  let apiKey: string | undefined
  let ownership: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
  let canSettleJob = false
  let nativeStarting = false
  let privatePending = false
  let nativeOutput: { getFullOutput(): Promise<{ finishReason?: string }> } | undefined
  let requestContext: ReturnType<typeof createCopilotRequestContext> | undefined
  let cancellationRequest: Promise<void> | undefined
  let transferred = false
  let selected: { target: Target; response: CopilotWorkerToolResult } | undefined
  const publishCancellation = () => {
    if (ownership?.signal.aborted) return
    cancellationRequest = studio.call('cancel', {})
    // Retain the failure for cleanup without rejecting while native tools are still draining.
    void cancellationRequest.catch(() => undefined)
  }
  const assertOwnership = async () => {
    cancellation.signal.throwIfAborted()
    await ownership!.renew()
    cancellation.signal.throwIfAborted()
  }
  const readCurrentJob = async () => {
    const current = await readCopilotJob(scope, threadId)
    if (current?.id !== jobId || current.runId !== runId)
      throw new NativeTargetError('This Copilot turn has changed', 409)
    return current
  }
  try {
    const currentJob = await readCurrentJob()
    if (currentJob.status) return
    const { admissionGeneration } = currentJob
    if (admissionGeneration === undefined)
      await waitForCopilotRunRelease(scope, threadId, runId, cancellation.signal)
    ownership = await claimCopilotThread(scope, threadId, runId, jobId, admissionGeneration)
    // Admission can settle the job while this worker waits for its claim.
    if ((await ownership.run(readCurrentJob)).status) return
    canSettleJob = true
    cancellation.signal.addEventListener('abort', publishCancellation, { once: true })
    if (cancellation.signal.aborted) publishCancellation()
    const signal = cancellation.signal
    const watchOwner = (current: NonNullable<typeof ownership>) =>
      current.signal.addEventListener('abort', () => cancellation.abort(current.signal.reason), {
        once: true,
      })
    watchOwner(ownership)
    const transferTool = async (target: Target, stage: CopilotWorkerToolInput['stage']) => {
      const current = ownership!
      await current.renew()
      await current.handoff()
      ownership = undefined
      transferred = true
      const transport = new AbortController()
      const frame = await studio
        .call(
          'tool',
          {
            target,
            fence: current.fence,
            stage,
            admission: 'target' in request ? request : undefined,
          },
          AbortSignal.any([signal, transport.signal])
        )
        .catch((error) => {
          transport.abort(error)
          throw error
        })
      ownership = await claimCopilotThread(scope, threadId, runId, jobId, frame.generation)
      watchOwner(ownership)
      transferred = false
      await studio.call('active', { fence: ownership.fence }, signal)
      if ('observe' in frame) {
        if (
          stage !== 'result' ||
          request.command !== 'tool.execute' ||
          request.action !== 'readback' ||
          target.toolName !== 'run_workflow'
        )
          throw new NativeTargetError('Unexpected workflow observation', 409)
        outcome = {
          status: 'suspended',
          workflowObservation: {
            requestId: request.requestId,
            nextRequestId: crypto.randomUUID(),
            target,
            handle: frame.observe,
          },
        }
        return false
      }
      selected = { target, response: frame.response }
      return true
    }
    if (request.command === 'tool.execute' || request.command === 'tool.result') {
      if (!(await transferTool(request.target, 'result'))) return
    }
    const preparedRun = await studio.call('prepare', { fence: ownership.fence }, signal)
    run = preparedRun.run
    const { pending, contexts } = preparedRun
    apiKey = preparedRun.model.apiKey
    const agent = await getCopilotAgent()
    const prepared = await prepareNativeModelRequest(
      {
        model: run.model,
        actorUserId: run.scope.actorUserId,
        workspaceId: run.scope.workspaceId,
        runId: run.runId,
        funding: 'account',
        signal,
      },
      {
        model: preparedRun.model,
        reasoning: run.reasoning,
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
      assertOwnership,
      executeTool: async (name, args, toolCallId) => {
        if (selected?.target.toolCallId === toolCallId && selected.target.toolName === name) {
          const { response } = selected
          selected = undefined
          return response
        }
        return {
          suspend: {
            originalArgs: args,
            ...(getCopilotToolPolicy(name).execution === 'server'
              ? { studioDispatch: true as const }
              : {}),
          },
        }
      },
    })
    let madeModelRequest = false
    const guard: InputProcessor = {
      id: 'studio-copilot-ownership',
      processInputStep: assertOwnership,
      processLLMRequest({ prompt, messageList }) {
        madeModelRequest = true
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
      onAbort: () => cancellation.abort(),
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
    nativeStarting = true
    let output = await ownership!.run(() =>
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
            : agent.resumeStream(
                {},
                {
                  ...options,
                  toolCallId: 'target' in request ? request.target.toolCallId : undefined,
                }
              )
    )
    for (;;) {
      nativeStarting = false
      nativeOutput = output
      let streamError: unknown
      for await (const part of output.fullStream) {
        if (part.type === 'error') streamError = part.payload.error
        // A native pause can persist even if the following discovery read fails.
        if (part.type === 'tool-call-approval') privatePending = false
        if (part.type === 'tool-call-suspended')
          privatePending = isStudioDispatch(part.payload.suspendPayload)
      }
      const error = streamError ?? (await output.error)
      if (error) throw error
      nativeOutput = undefined
      signal.throwIfAborted()
      const { resourceId } = nativeConversationIdentity(run.scope)
      const { runs } = await agent.listSuspendedRuns({ threadId, resourceId })
      const suspended = runs.find((item) => item.runId === runId)
      if (!suspended) {
        privatePending = false
        const result = await output.getFullOutput()
        await prepared.complete(result)
        getNativeFinalText(result)
        outcome = { status: 'success' }
        break
      }
      const call = suspended.toolCalls.find(
        (item) => !item.requiresApproval && isStudioDispatch(item.suspendPayload)
      )
      if (!call) {
        privatePending = false
        if (madeModelRequest) await prepared.usage.verifyComplete()
        outcome = { status: 'suspended' }
        break
      }
      privatePending = true
      if (!call.toolCallId || !call.toolName)
        throw new NativeTargetError('Suspended Copilot tool is unavailable', 409)
      await transferTool(
        { runId, threadId, resourceId, toolName: call.toolName, toolCallId: call.toolCallId },
        'studio'
      )
      nativeStarting = true
      output = await ownership!.run(() =>
        agent.resumeStream({}, { ...options, runId, toolCallId: call.toolCallId })
      )
    }
  } catch (error) {
    if (error instanceof CopilotRunCancelled) cancellation.abort(error)
    outcome = cancellation.signal.aborted
      ? { status: 'aborted' }
      : { status: 'failed', error: copilotFailure(error, apiKey).error }
    if (transferred) {
      // Studio can still own an interrupted effect. Only its successor may settle this job.
      await cancellationRequest
      if (cancellation.signal.aborted)
        await waitForCopilotRunRelease(scope, threadId, runId, new AbortController().signal)
      await studio.call('finalize', { message: copilotFailure(error, apiKey).error.message })
    } else if (!ownership || !canSettleJob) throw error
  } finally {
    try {
      // stream() can reject during startup, including after it started asynchronous work.
      if (ownership && !ownership.signal.aborted && run && nativeStarting) {
        cancellation.abort()
        await publishAbortRequest((await getMastra()).pubsub, run.runId)
      }
      // Drain native work and outstanding HTTP calls; a lost response cannot prove tool completion.
      await nativeOutput?.getFullOutput().catch(() => undefined)
      if (requestContext) await Promise.all(getCopilotExecution(requestContext)!.pendingTools)
      await cancellationRequest
      if (
        ownership &&
        run &&
        (cancellation.signal.aborted ||
          ((privatePending || selected) && outcome.status === 'failed')) &&
        !ownership.signal.aborted &&
        !(await hasPendingWorkflowReadback(scope, threadId, await readCurrentJob()))
      ) {
        await ownership.renew()
        await ownership.run(() => deleteCopilotRunSnapshot(run!.runId))
      }
    } finally {
      try {
        if (canSettleJob && ownership && !ownership.signal.aborted) {
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
