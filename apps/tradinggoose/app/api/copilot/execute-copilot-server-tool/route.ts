import { FinancialPolicyError } from '@tradinggoose/billing'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import { nativeFinancialRootId, nativeResultBinding } from '@/lib/copilot/native/identity'
import { readbackNativeToolResult } from '@/lib/copilot/native/readback'
import { parseStudioNativeExecutionRequest } from '@/lib/copilot/native/studio-execution'
import {
  authorizeNativeConversationScope,
  copyNativeFinancialSource,
  getNativeFinancialSource,
  NativeTargetError,
  resolveNativePendingTarget,
} from '@/lib/copilot/native/target'
import { isToolId, ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { createCopilotToolResultProof } from '@/lib/copilot/result-proof'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import {
  hashServerToolReviewBase,
  type ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  acceptServerManagedToolReview,
  rejectServerManagedToolReview,
  stageServerManagedToolReview,
} from '@/lib/copilot/tools/server/review-acceptance'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, type InferenceFacts } from '@/lib/mastra/result'

export async function POST(request: NextRequest) {
  let toolName: string | undefined
  let completedFacts: InferenceFacts | undefined
  try {
    const session = await getSession()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await parseStudioNativeExecutionRequest(await request.json())
    const scope = await authorizeNativeConversationScope(session.user.id, input.native.workspaceId)
    const pending = await resolveNativePendingTarget(
      scope,
      input.native.target,
      'result',
      request.signal
    )
    toolName = pending.target.toolName
    if (!isToolId(toolName)) throw new NativeTargetError('Unknown native tool', 422)
    const policy = getCopilotToolPolicy(toolName)
    if (input.action !== 'readback' && policy.execution !== 'server') {
      throw new NativeTargetError(
        'This native tool executes through its browser business flow',
        422
      )
    }
    const args = ToolArgSchemas[toolName].parse(pending.originalArgs)
    const context: ServerToolExecutionContext = {
      ...input.context,
      userId: scope.actorUserId,
      accessLevel:
        input.action === 'review.accept' || input.action === 'review.reject'
          ? 'limited'
          : (input.accessLevel ?? 'limited'),
      signal: request.signal,
      nativeReviewBinding: hashServerToolReviewBase({
        target: pending.target,
        scope,
        financialRootId: nativeFinancialRootId(pending.financialBinding),
        financialBinding: pending.financialBinding,
        financialOccurrence: pending.financialOccurrence,
        originalArgs: pending.originalArgs,
      }),
    }
    if (toolName === 'search_documentation' && input.action === 'execute') {
      const source = getNativeFinancialSource(pending)
      if (!source || source.signal !== request.signal)
        throw new NativeTargetError(
          'Original native documentation financial provenance is missing',
          403
        )
      copyNativeFinancialSource(pending, context)
    }
    if (
      context.contextEntityKind === 'dashboard_layout' &&
      context.contextEntityId?.includes('dashboard_layout:')
    ) {
      throw new NativeTargetError('dashboard_layout contextEntityId must be the raw layout id', 422)
    }
    await authorizeNativeBusinessResult(scope, pending, undefined, context)
    if (request.signal.aborted) throw request.signal.reason ?? new Error('Aborted')
    const result =
      input.action === 'readback'
        ? await readbackNativeToolResult(scope, pending, context, input.readback)
        : input.action === 'review.reject'
          ? await rejectServerManagedToolReview(toolName, input.reviewToken!, context)
          : input.action === 'review.accept'
            ? await acceptServerManagedToolReview(toolName, input.reviewToken!, context)
            : await stageServerManagedToolReview(
                toolName,
                pending.originalArgs,
                await routeExecution(toolName, args, context),
                context
              )
    completedFacts = getInferenceFacts(result)
    if (
      result &&
      typeof result === 'object' &&
      'requiresReview' in result &&
      result.requiresReview === true
    ) {
      return NextResponse.json({ success: true, result })
    }
    // The business action/decision may have changed state. Recheck before evidence; never redispatch it to recover evidence.
    const currentPending = await resolveNativePendingTarget(
      scope,
      input.native.target,
      'result',
      request.signal
    )
    if (stableStringifyJsonValue(currentPending) !== stableStringifyJsonValue(pending)) {
      throw new NativeTargetError(
        'Original native pending target changed after execution; do not repeat the effect',
        409
      )
    }
    const typedResult = ToolResultSchemas[toolName].parse(result)
    await authorizeNativeBusinessResult(scope, pending, typedResult, context)
    if (request.signal.aborted) throw request.signal.reason ?? new Error('Aborted')
    const proof = await createCopilotToolResultProof({
      binding: nativeResultBinding(scope, pending),
      originalArgs: pending.originalArgs,
      result: typedResult,
    })
    return NextResponse.json({ success: true, result: typedResult, proof })
  } catch (error) {
    const facts = getInferenceFacts(error) ?? completedFacts
    const accounting = facts ? getFailureAccounting(facts) : {}
    if (error instanceof NativeTargetError || error instanceof FinancialPolicyError)
      return NextResponse.json(
        {
          error: error.message,
          code:
            error instanceof FinancialPolicyError
              ? (error.code ?? 'native_target_rejected')
              : 'native_target_rejected',
          retryable: false,
          ...accounting,
        },
        { status: error.status }
      )
    const structured = buildCopilotServerToolErrorResponse(toolName, error)
    return NextResponse.json({ ...structured.body, ...accounting }, { status: structured.status })
  }
}
