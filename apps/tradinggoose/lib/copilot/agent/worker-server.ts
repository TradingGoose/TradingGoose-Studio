import { z } from 'zod'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { validateNativeBrowserAssertion } from '@/lib/copilot/native/browser-assertion'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import { COPILOT_CONTEXT_PART } from '@/lib/copilot/native/contract'
import { NativeTargetError, ObserveResumedWorkflow } from '@/lib/copilot/native/errors'
import { nativeAdmissionId } from '@/lib/copilot/native/identity'
import { readbackNativeToolResult } from '@/lib/copilot/native/readback'
import {
  authorizeNativeConversationScope,
  resolveNativePendingTarget,
  type ServerPending,
} from '@/lib/copilot/native/target'
import { isToolId, ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { getCopilotToolPolicy, isWorkspaceAgnosticServerTool } from '@/lib/copilot/tool-policy'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { nativeReasoningSettings } from '@/lib/mastra/native-reasoning'
import { createModelUsageAccounting } from '@/lib/mastra/request'
import { getNativeMemoryStore } from '@/lib/mastra/runtime'
import { type CopilotDecision, readCopilotRun } from './context'
import { copilotFailure } from './errors'
import {
  type CopilotRun,
  claimCopilotThread,
  deleteCopilotRunSnapshot,
  hasPendingWorkflowReadback,
  readCopilotJob,
  readCopilotThreadOwnership,
  saveCopilotJob,
} from './ownership'
import {
  assertCopilotRunActive,
  cancelCopilotRun,
  claimCopilotEffect,
  readCopilotAdmission,
  readCopilotCancellation,
} from './receipts'
import {
  COPILOT_CANCELLATION_POLL_INTERVAL,
  type CopilotJob,
  type CopilotWorkerIdentity,
  type CopilotWorkerOperation,
  type CopilotWorkerOperations,
  type CopilotWorkerPrepared,
  CopilotWorkerToolInputSchema,
  type CopilotWorkerToolResult,
} from './worker-contract'

const FenceSchema = z.object({
  runId: z.string().min(1),
  ownerId: z.string().min(1),
  generation: z.number().int().nonnegative(),
})
type WorkerContext = CopilotJob | CopilotWorkerIdentity
const identityOf = (context: WorkerContext): CopilotWorkerIdentity =>
  'request' in context
    ? {
        actorUserId: context.actorUserId,
        workspaceId: context.request.workspaceId,
        threadId: context.threadId,
        runId: context.runId,
        jobId: context.jobId,
      }
    : context
const scopeOf = (context: WorkerContext) => ({
  actorUserId: context.actorUserId,
  workspaceId: identityOf(context).workspaceId,
})

async function validateJob(context: WorkerContext) {
  const identity = identityOf(context)
  const scope = scopeOf(context)
  if ('request' in context) {
    const request = context.request
    if (
      !('requestId' in request) ||
      nativeAdmissionId(scope, request.requestId) !== context.jobId ||
      context.threadId !==
        (request.command === 'message'
          ? (request.threadId ?? context.jobId)
          : request.target.threadId) ||
      context.runId !== (request.command === 'message' ? context.jobId : request.target.runId) ||
      (request.command === 'message' && context.messageId !== (request.messageId ?? context.jobId))
    )
      throw new NativeTargetError('Copilot worker admission does not match its command', 403)
  }
  const current = await readCopilotJob(scope, identity.threadId)
  if (!current || current.id !== identity.jobId || current.runId !== identity.runId)
    throw new NativeTargetError('This Copilot turn has changed', 409)
  return current
}

async function validateFence(context: WorkerContext, value: unknown) {
  const fence = FenceSchema.parse(value)
  const owner = await readCopilotThreadOwnership(scopeOf(context), context.threadId)
  if (
    !owner?.live ||
    owner.runId !== fence.runId ||
    owner.ownerId !== context.runId ||
    owner.ownerId !== fence.ownerId ||
    owner.generation !== fence.generation
  )
    throw new NativeTargetError('This Copilot turn no longer owns the conversation', 409)
}

async function prepare(job: CopilotJob, signal?: AbortSignal): Promise<CopilotWorkerPrepared> {
  const scope = scopeOf(job)
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  const request = job.request
  const run: CopilotRun =
    request.command === 'message'
      ? {
          runId: job.runId,
          threadId: job.threadId,
          scope,
          model: request.model,
          reasoning: request.reasoning,
          accessLevel: request.accessLevel ?? 'limited',
          toolContext: request.toolContext,
          toolContexts: job.toolContexts,
        }
      : await readCopilotRun(scope, job.threadId, job.runId)
  const selected = await resolveCopilotModel(run.model, run.reasoning)
  const model = await resolveConfiguredModel(run.model, selected.apiKey)
  let pending: CopilotWorkerPrepared['pending']
  if (request.command === 'tool.approve' || request.command === 'tool.decline') {
    if (!(await readCopilotAdmission(run, request)))
      throw new NativeTargetError('Tool continuation was not admitted', 403)
    pending = await resolveNativePendingTarget(scope, request.target, 'approval', signal)
    await authorizeNativeBusinessResult(scope, pending)
  }
  let contexts: CopilotWorkerPrepared['contexts'] = []
  if (request.command === 'message') {
    const message = (
      await (await getNativeMemoryStore()).listMessagesById({ messageIds: [job.messageId!] })
    ).messages[0]
    if (!message) throw new NativeTargetError('Submitted Copilot message is unavailable', 409)
    const references = message.content.parts.flatMap((part) =>
      part.type === COPILOT_CONTEXT_PART && 'data' in part
        ? ChatContextSchema.array().parse(part.data)
        : []
    )
    if (references.length)
      contexts = await (await import('@/lib/copilot/process-contents')).processContextsServer(
        references,
        scope.actorUserId,
        message.content.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
        scope.workspaceId ?? undefined,
        { signal }
      )
  }
  return {
    run,
    pending,
    contexts,
    model,
    reasoning: run.reasoning && nativeReasoningSettings(run.model, run.reasoning),
  }
}

/** Studio owns business authorization, approvals and effects; the worker owns native suspension. */
export async function executeCopilotWorkerTool(
  input: { run: CopilotRun; pending: ServerPending; decision?: CopilotDecision },
  signal?: AbortSignal
): Promise<CopilotWorkerToolResult> {
  const { run, pending, decision } = input
  const { toolName: name, toolCallId } = pending.target
  if (!isToolId(name)) throw new NativeTargetError('Unknown native tool', 422)
  const args = ToolArgSchemas[name].parse(pending.originalArgs)
  signal?.throwIfAborted()
  await authorizeNativeConversationScope(run.scope.actorUserId, run.scope.workspaceId)
  await assertCopilotRunActive(run.runId)
  const context = isWorkspaceAgnosticServerTool(name)
    ? { workspaceId: run.scope.workspaceId ?? undefined }
    : pending.context
  const businessContext = {
    ...context,
    userId: run.scope.actorUserId,
    accessLevel: run.accessLevel,
    signal,
  }
  if (decision?.action !== 'result')
    await authorizeNativeBusinessResult(run.scope, pending, undefined, businessContext)
  let result: unknown
  if (decision?.action === 'result') result = decision.result
  else if (pending.preview || getCopilotToolPolicy(name).execution === 'server') {
    const { routeExecution } = await import('@/lib/copilot/tools/server/router')
    if (pending.preview) {
      const baseStateHash = pending.reviewBaseStateHash
      if (
        !decision ||
        !['review.accept', 'review.reject'].includes(decision.action) ||
        !baseStateHash
      )
        throw new NativeTargetError('A decision on the current preview is required', 409)
      await claimCopilotEffect(run, toolCallId, 'review')
      result =
        decision.action === 'review.accept'
          ? await routeExecution(name, args, {
              ...businessContext,
              accessLevel: 'full',
              acceptedReviewBaseStateHash: baseStateHash,
            })
          : { success: false, rejected: true, toolName: name }
    } else {
      await claimCopilotEffect(run, toolCallId, 'execute')
      result = await routeExecution(name, args, businessContext)
    }
  } else return { suspend: { originalArgs: args } }
  if (
    result &&
    typeof result === 'object' &&
    'requiresReview' in result &&
    result.requiresReview === true
  ) {
    const { reviewBaseStateHash, ...preview } = result as Record<string, any>
    if (typeof reviewBaseStateHash !== 'string' || !reviewBaseStateHash)
      throw new NativeTargetError('Tool preview is missing its current base state', 409)
    return { suspend: { originalArgs: args, preview, reviewBaseStateHash } }
  }
  const typed = ToolResultSchemas[name].parse(result)
  await authorizeNativeBusinessResult(run.scope, pending, typed, businessContext)
  signal?.throwIfAborted()
  return { result: typed }
}

async function executeSavedTool(
  identity: CopilotWorkerIdentity,
  input: ReturnType<typeof CopilotWorkerToolInputSchema.parse>,
  signal: AbortSignal
) {
  const scope = scopeOf(identity)
  const { target, admission, stage } = input
  if (target.threadId !== identity.threadId || target.runId !== identity.runId)
    throw new NativeTargetError('The tool belongs to another Copilot run', 403)
  const run = await readCopilotRun(scope, target.threadId, target.runId)
  if (admission) {
    if (
      admission.workspaceId !== scope.workspaceId ||
      admission.target.threadId !== run.threadId ||
      admission.target.runId !== run.runId ||
      nativeAdmissionId(scope, admission.requestId) !== identity.jobId ||
      !(await readCopilotAdmission(run, admission))
    )
      throw new NativeTargetError('Tool continuation was not admitted', 403)
  } else if (identity.jobId !== run.runId)
    throw new NativeTargetError('Tool continuation requires its admitted command', 403)
  const pending = await resolveNativePendingTarget(scope, target, stage, signal)
  let decision: CopilotDecision | undefined
  if (stage === 'result') {
    const continuation = admission
    if (
      (continuation?.command !== 'tool.execute' && continuation?.command !== 'tool.result') ||
      stableStringifyJsonValue(continuation.target) !== stableStringifyJsonValue(target)
    )
      throw new NativeTargetError('Tool decision does not match the saved target', 403)
    await resolveCopilotModel(run.model, run.reasoning)
    if (continuation.command === 'tool.result') {
      await authorizeNativeBusinessResult(scope, pending)
      validateNativeBrowserAssertion(pending, continuation.assertion)
      decision = {
        action: 'result',
        result:
          continuation.assertion.kind === 'ui.opened'
            ? {
                message:
                  'The requested Studio dialog was opened. User completion is still required.',
              }
            : continuation.assertion.data,
      }
    } else {
      const context = { ...pending.context, userId: scope.actorUserId, signal }
      for (const [key, value] of Object.entries(continuation.context ?? {})) {
        if (value === undefined || value === pending.context?.[key as keyof typeof pending.context])
          continue
        if (
          key === 'workspaceId' &&
          !pending.context?.workspaceId &&
          ['gdrive_request_access', 'oauth_request_access'].includes(target.toolName)
        ) {
          await authorizeNativeConversationScope(scope.actorUserId, value)
          context.workspaceId = value
        } else throw new NativeTargetError('The original tool context has changed', 403)
      }
      if (continuation.action === 'readback') {
        // The readback authorizes the selected workspace and reads the canonical postcondition.
        const result = await readbackNativeToolResult(
          scope,
          pending,
          context,
          continuation.readback
        )
        if (!isToolId(target.toolName)) throw new NativeTargetError('Unknown native tool', 422)
        const typed = ToolResultSchemas[target.toolName].parse(result)
        if (target.toolName !== 'run_workflow')
          await authorizeNativeBusinessResult(scope, pending, typed, context)
        return { result: typed }
      }
      if (!pending.preview || !pending.reviewBaseStateHash)
        throw new NativeTargetError('The current tool preview is required', 409)
      decision = { action: continuation.action }
    }
  }
  try {
    return await executeCopilotWorkerTool({ run, pending, decision }, signal)
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof NativeTargetError) return { error: copilotFailure(error).error.message }
    return { error: buildCopilotServerToolErrorResponse(target.toolName, error).body.error }
  }
}

async function ownStudioTool(
  identity: CopilotWorkerIdentity,
  input: ReturnType<typeof CopilotWorkerToolInputSchema.parse>,
  requestSignal?: AbortSignal
) {
  const scope = scopeOf(identity)
  const owner = await claimCopilotThread(
    scope,
    identity.threadId,
    identity.runId,
    identity.jobId,
    input.fence.generation
  )
  const stop = new AbortController()
  const signal = AbortSignal.any([
    owner.signal,
    stop.signal,
    ...(requestSignal ? [requestSignal] : []),
  ])
  let checking: Promise<void> | undefined
  const timer = setInterval(() => {
    if (!checking && !signal.aborted)
      checking = assertCopilotRunActive(identity.runId)
        .catch((error) => stop.abort(error))
        .finally(() => {
          checking = undefined
        })
  }, COPILOT_CANCELLATION_POLL_INTERVAL)
  let handback = false
  try {
    const value = await owner.run(async () => {
      await owner.renew()
      if ((await readCopilotJob(scope, identity.threadId))?.status)
        throw new NativeTargetError('This Copilot job has already ended', 409)
      await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
      await assertCopilotRunActive(identity.runId)
      signal.throwIfAborted()
      try {
        return { response: await executeSavedTool(identity, input, signal) }
      } catch (error) {
        if (error instanceof ObserveResumedWorkflow) return { observe: error.handle }
        throw error
      }
    })
    await assertCopilotRunActive(identity.runId)
    signal.throwIfAborted()
    await owner.renew()
    handback = true
    return { generation: owner.fence.generation, ...value }
  } catch (error) {
    // A disconnected caller cannot acknowledge the effect. Settle only after the operation drained.
    if (!owner.signal.aborted)
      await owner.run(async () => {
        const job = await readCopilotJob(scope, identity.threadId)
        if (job?.status) return
        const cancellation = await readCopilotCancellation(identity.runId)
        if (
          cancellation === 'settled' ||
          (!cancellation &&
            (signal.aborted || input.stage === 'studio') &&
            !(await hasPendingWorkflowReadback(scope, identity.threadId, job)))
        ) {
          await cancelCopilotRun({ scope, runId: identity.runId, threadId: identity.threadId })
          await deleteCopilotRunSnapshot(identity.runId)
        }
        await saveCopilotJob(
          scope,
          identity.threadId,
          identity.jobId,
          cancellation
            ? { status: 'aborted' }
            : { status: 'failed', error: copilotFailure(error).error }
        )
      })
    throw error
  } finally {
    clearInterval(timer)
    if (handback) await owner.handoff()
    else await owner.release()
  }
}

export function handleCopilotWorkerOperation<K extends CopilotWorkerOperation>(
  context: WorkerContext,
  operation: K,
  input: CopilotWorkerOperations[K]['input'],
  signal?: AbortSignal
): Promise<CopilotWorkerOperations[K]['output']>
export async function handleCopilotWorkerOperation(
  context: WorkerContext,
  operation: CopilotWorkerOperation,
  input: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const fields = z.record(z.string(), z.unknown()).parse(input)
  const identity = identityOf(context)
  const scope = scopeOf(context)
  if ('request' in context && operation !== 'prepare' && operation !== 'finalize')
    throw new NativeTargetError('This operation requires its authenticated worker identity', 422)
  if (operation === 'usage.record') {
    const attemptId = z.string().min(1).parse(fields.attemptId)
    if (!attemptId.startsWith(`${identity.runId}:`))
      throw new NativeTargetError('Model attempt belongs to another run', 403)
    const model = identity.model
    if (!model) throw new NativeTargetError('The admitted model is required', 403)
    return createModelUsageAccounting({
      ...scope,
      workspaceId: scope.workspaceId ?? undefined,
      model,
      runId: identity.runId,
      purpose: 'copilot',
      funding: 'account',
    }).record(
      z.record(z.string(), z.unknown()).parse(fields.usage),
      fields.providerMetadata as Record<string, unknown> | undefined,
      attemptId
    )
  }
  const job = await validateJob(context)
  if (operation === 'finalize') {
    if (!('request' in context)) throw new NativeTargetError('The original job is required', 422)
    await (await import('./service')).finalizeCopilotJob(context, z.string().parse(fields.message))
    return
  }
  if (operation === 'cancel') {
    if (await hasPendingWorkflowReadback(scope, identity.threadId, job)) return
    return cancelCopilotRun({ scope, threadId: identity.threadId, runId: identity.runId })
  }
  await validateFence(context, fields.fence)
  await assertCopilotRunActive(identity.runId)
  if (operation === 'prepare') {
    if (!('request' in context)) throw new NativeTargetError('The original job is required', 422)
    return prepare(context, signal)
  }
  if (operation === 'active') return
  if (operation === 'tool')
    return ownStudioTool(identity, CopilotWorkerToolInputSchema.parse(fields), signal)
  const model = identity.model
  if (!model) throw new NativeTargetError('The admitted model is required', 403)
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  const usage = createModelUsageAccounting({
    ...scope,
    workspaceId: scope.workspaceId ?? undefined,
    model,
    runId: identity.runId,
    purpose: 'copilot',
    funding: 'account',
    signal,
  })
  if (operation === 'usage.allow') return usage.assertAllowed()
}
