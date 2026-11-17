import type { RunFence } from '@mastra/core/storage'
import { z } from 'zod'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { validateNativeBrowserAssertion } from '@/lib/copilot/native/browser-assertion'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import { COPILOT_CONTEXT_PART } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeAdmissionId, nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { readbackNativeToolResult } from '@/lib/copilot/native/readback'
import {
  authorizeNativeConversationScope,
  resolveNativePendingTarget,
} from '@/lib/copilot/native/target'
import { isToolId, ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { resolveCopilotModel } from '@/lib/copilot/settings.server'
import { getCopilotToolPolicy, isWorkspaceAgnosticServerTool } from '@/lib/copilot/tool-policy'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { createModelUsageAccounting } from '@/lib/mastra/request'
import { getNativeMemoryStore, getNativeWorkflowsStore } from '@/lib/mastra/runtime'
import { type CopilotDecision, readCopilotRun, resolveCopilotRunToolContext } from './context'
import {
  type CopilotRun,
  maintainCopilotThreadLease,
  readCopilotJob,
  readCopilotThreadOwnership,
} from './ownership'
import { assertCopilotRunActive, cancelCopilotRun, claimCopilotEffect } from './receipts'
import {
  COPILOT_CANCELLATION_POLL_INTERVAL,
  type CopilotJob,
  type CopilotWorkerIdentity,
  type CopilotWorkerOperation,
  type CopilotWorkerOperations,
  type CopilotWorkerPrepared,
  type CopilotWorkerToolInput,
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
  return {
    fence,
    leaseDeadline: performance.now() + Math.max(0, owner.leaseExpiresAt!.getTime() - Date.now()),
  }
}

async function runForJob(job: CopilotJob): Promise<CopilotRun> {
  const scope = scopeOf(job)
  return job.request.command === 'message'
    ? {
        runId: job.runId,
        threadId: job.threadId,
        scope,
        model: job.request.model,
        providerOptions: job.request.providerOptions,
        accessLevel: job.request.accessLevel ?? 'limited',
        toolContext: job.request.toolContext,
        toolContexts: job.toolContexts,
      }
    : readCopilotRun(scope, job.threadId, job.runId)
}

async function prepare(job: CopilotJob, signal?: AbortSignal): Promise<CopilotWorkerPrepared> {
  const scope = scopeOf(job)
  await authorizeNativeConversationScope(scope.actorUserId, scope.workspaceId)
  const run = await runForJob(job)
  const selected = await resolveCopilotModel(run.model)
  const model = await resolveConfiguredModel(run.model, selected.apiKey)
  let pending: CopilotWorkerPrepared['pending']
  let decision: CopilotDecision | undefined
  const request = job.request
  if ('target' in request) {
    pending = await resolveNativePendingTarget(
      scope,
      request.target,
      request.command === 'tool.approve' || request.command === 'tool.decline'
        ? 'approval'
        : 'result',
      signal
    )
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
      const businessContext = { ...pending.context, userId: run.scope.actorUserId, signal }
      for (const [key, value] of Object.entries(request.context ?? {})) {
        if (value === undefined || value === pending.context?.[key as keyof typeof pending.context])
          continue
        if (
          key === 'workspaceId' &&
          !pending.context?.workspaceId &&
          ['gdrive_request_access', 'oauth_request_access'].includes(pending.target.toolName)
        ) {
          await authorizeNativeConversationScope(run.scope.actorUserId, value)
          businessContext.workspaceId = value
        } else throw new NativeTargetError('The original tool context has changed', 403)
      }
      if (request.action !== 'readback')
        await authorizeNativeBusinessResult(scope, pending, undefined, businessContext)
      if (request.action === 'readback')
        decision = {
          action: 'result',
          result: await readbackNativeToolResult(scope, pending, businessContext, request.readback),
        }
      else {
        if (!pending.preview || !pending.reviewBaseStateHash)
          throw new NativeTargetError('The current tool preview is required', 409)
        decision = { action: request.action }
      }
    }
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
  return { run, pending, decision, contexts, model }
}

/** Studio owns business authorization, approvals and effects; the worker owns native suspension. */
export async function executeCopilotWorkerTool(
  input: Omit<CopilotWorkerToolInput, 'fence'>,
  signal?: AbortSignal
): Promise<CopilotWorkerToolResult> {
  const { run, pending: previous, decision, toolName: name, toolCallId } = input
  if (!isToolId(name)) throw new NativeTargetError('Unknown native tool', 422)
  const args = ToolArgSchemas[name].parse(input.args)
  signal?.throwIfAborted()
  await authorizeNativeConversationScope(run.scope.actorUserId, run.scope.workspaceId)
  await assertCopilotRunActive(run.runId)
  const resumed =
    previous?.target.runId === run.runId &&
    previous.target.threadId === run.threadId &&
    previous.target.toolCallId === toolCallId &&
    previous.target.toolName === name
  if (resumed && stableStringifyJsonValue(previous.originalArgs) !== stableStringifyJsonValue(args))
    throw new NativeTargetError('Suspended Copilot tool arguments have changed', 403)
  const pending = {
    target: {
      threadId: run.threadId,
      resourceId: nativeConversationIdentity(run.scope).resourceId,
      runId: run.runId,
      toolCallId,
      toolName: name,
    },
    stage: 'result' as const,
    originalArgs: args,
    context: isWorkspaceAgnosticServerTool(name)
      ? run.scope.workspaceId
        ? { workspaceId: run.scope.workspaceId }
        : undefined
      : resolveCopilotRunToolContext(run, name, args),
    ...(resumed && previous.preview ? { preview: previous.preview } : {}),
  }
  const businessContext = {
    ...pending.context,
    userId: run.scope.actorUserId,
    accessLevel: run.accessLevel,
    signal,
  }
  if (!(resumed && decision?.action === 'result'))
    await authorizeNativeBusinessResult(run.scope, pending, undefined, businessContext)
  let result: unknown
  if (resumed && decision?.action === 'result') result = decision.result
  else if (pending.preview || getCopilotToolPolicy(name).execution === 'server') {
    const { routeExecution } = await import('@/lib/copilot/tools/server/router')
    if (pending.preview) {
      const baseStateHash = previous?.reviewBaseStateHash
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

async function withToolLease<T>(
  runId: string,
  fence: RunFence,
  leaseDeadline: number,
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
) {
  const workflows = await getNativeWorkflowsStore()
  const lease = maintainCopilotThreadLease(workflows, fence, leaseDeadline)
  const cancellation = new AbortController()
  let checking: Promise<void> | undefined
  const cancellationTimer = setInterval(() => {
    if (checking || cancellation.signal.aborted) return
    checking = assertCopilotRunActive(runId)
      .catch((error) => cancellation.abort(error))
      .finally(() => {
        checking = undefined
      })
  }, COPILOT_CANCELLATION_POLL_INTERVAL)
  try {
    await lease.renew()
    return await operation(
      AbortSignal.any([lease.signal, cancellation.signal, ...(signal ? [signal] : [])])
    )
  } finally {
    clearInterval(cancellationTimer)
    await lease.handoff()
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
  await validateJob(context)
  if (operation === 'finalize') {
    if (!('request' in context)) throw new NativeTargetError('The original job is required', 422)
    await (await import('./service')).finalizeCopilotJob(context, z.string().parse(fields.message))
    return
  }
  if (operation === 'cancel')
    return cancelCopilotRun({ scope, threadId: identity.threadId, runId: identity.runId })
  const { fence, leaseDeadline } = await validateFence(context, fields.fence)
  await assertCopilotRunActive(identity.runId)
  if (operation === 'prepare') {
    if (!('request' in context)) throw new NativeTargetError('The original job is required', 422)
    return prepare(context, signal)
  }
  if (operation === 'active') return
  if (operation === 'tool') {
    const tool = input as CopilotWorkerToolInput
    if (
      tool.run.runId !== identity.runId ||
      tool.run.threadId !== identity.threadId ||
      stableStringifyJsonValue(tool.run.scope) !== stableStringifyJsonValue(scope) ||
      (!('request' in context) && context.model !== tool.run.model)
    )
      throw new NativeTargetError('The tool belongs to another Copilot run', 403)
    return withToolLease(identity.runId, fence, leaseDeadline, signal, async (toolSignal) => {
      try {
        return await executeCopilotWorkerTool(tool, toolSignal)
      } catch (error) {
        toolSignal.throwIfAborted()
        if (error instanceof NativeTargetError) throw error
        const failure = buildCopilotServerToolErrorResponse(tool.toolName, error)
        return { error: failure.body.error }
      }
    })
  }
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
