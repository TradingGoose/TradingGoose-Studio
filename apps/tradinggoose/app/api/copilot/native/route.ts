import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { replaceCopilotWorkspaceEntityMentionsWithIds } from '@/lib/copilot/chat-contexts'
import { MAX_COPILOT_CONTEXTS_PER_TURN } from '@/lib/copilot/context-limits'
import { validateNativeBrowserAssertion } from '@/lib/copilot/native/browser-assertion'
import { authorizeNativeBusinessResult } from '@/lib/copilot/native/business-access'
import { fetchNativeCopilot } from '@/lib/copilot/native/client'
import {
  assertNativeCommandResponse,
  assertNativeCorrelation,
  COPILOT_NATIVE_REVISION,
  NativeCommandResponseError,
  parseNativeContract,
} from '@/lib/copilot/native/contract'
import { readNativeThreadHistory } from '@/lib/copilot/native/history'
import { nativeResultBinding } from '@/lib/copilot/native/identity'
import { prepareNativeImageParts } from '@/lib/copilot/native/images'
import { relayNativeEvents } from '@/lib/copilot/native/stream'
import { parseStudioNativeCommand } from '@/lib/copilot/native/studio-request'
import {
  authorizeNativeConversationScope,
  NativeTargetError,
  resolveNativePendingTarget,
} from '@/lib/copilot/native/target'
import { processContextsServer } from '@/lib/copilot/process-contents'
import { isToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import { verifyCopilotToolResultProof } from '@/lib/copilot/result-proof'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { CopilotSourceError } from '@/lib/uploads/contexts/copilot/source-proof'
import { SSE_HEADERS } from '@/lib/utils'

export async function POST(request: NextRequest) {
  let requestId = crypto.randomUUID()
  let delegated = false
  const upstreamAbort = new AbortController()
  const abort = () => upstreamAbort.abort(request.signal.reason)
  if (request.signal.aborted) abort()
  else request.signal.addEventListener('abort', abort, { once: true })
  try {
    const session = await getSession()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await parseStudioNativeCommand(await request.json())
    requestId = input.requestId
    const scope = await authorizeNativeConversationScope(session.user.id, input.workspaceId)
    const command: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(input).filter(
          ([key]) => !['workspaceId', 'accessLevel', 'fileAttachments'].includes(key)
        )
      ),
      protocolRevision: COPILOT_NATIVE_REVISION,
      scope,
    }
    if (input.command === 'message') {
      z.enum(COPILOT_RUNTIME_MODELS).parse(input.model)
      if (input.workflowId) {
        const workflow = await authorizeWorkflowScope(
          { success: true, userId: session.user.id },
          input.workflowId,
          'read'
        )
        if (!workflow.ok) throw new NativeTargetError(workflow.error, workflow.status)
        if (scope.workspaceId !== null && workflow.workspaceId !== scope.workspaceId) {
          throw new NativeTargetError(
            'Workflow is outside the selected conversation workspace',
            403
          )
        }
      }
      if (input.fileAttachments?.length) {
        const { authorizeCopilotAttachments } = await import(
          '@/lib/uploads/contexts/copilot/copilot-file-manager'
        )
        await authorizeCopilotAttachments(
          input.fileAttachments,
          { actorUserId: session.user.id, workspaceId: scope.workspaceId },
          upstreamAbort.signal
        )
      }
      const contexts = z
        .array(ChatContextSchema)
        .max(MAX_COPILOT_CONTEXTS_PER_TURN)
        .parse(input.input.contexts ?? [])
      const text = replaceCopilotWorkspaceEntityMentionsWithIds(input.input.content, contexts)
      const resolvedContexts = await processContextsServer(
        contexts,
        session.user.id,
        text,
        scope.workspaceId ?? undefined,
        { signal: upstreamAbort.signal }
      )
      const images = input.fileAttachments?.length
        ? await prepareNativeImageParts(
            input.fileAttachments,
            scope,
            requestId,
            upstreamAbort.signal
          )
        : []
      command.input = {
        ...input.input,
        content: images.length ? [{ type: 'text', text }, ...images] : text,
        contexts: resolvedContexts,
      }
      command.toolManifest = await getCopilotRuntimeToolManifest(input.accessLevel ?? 'limited')
    } else if (input.command === 'context.compact') {
      z.enum(COPILOT_RUNTIME_MODELS).parse(input.model)
    } else if (input.command === 'history.edit') {
      const history = await readNativeThreadHistory(scope, input.threadId, upstreamAbort.signal)
      const message = history.find((message) => message.id === input.messageId)
      if (!message) throw new NativeTargetError('Native edit message is unavailable', 404)
      if (!message.parts.length || message.parts.some((part) => part.type !== 'text'))
        throw new NativeTargetError(
          'Messages with images or other non-text parts cannot be edited. Send a new message instead.',
          422
        )
    } else if (
      input.command === 'tool.approve' ||
      input.command === 'tool.decline' ||
      input.command === 'tool.result'
    ) {
      const pending = await resolveNativePendingTarget(
        scope,
        input.target,
        input.command === 'tool.result' ? 'result' : 'approval',
        upstreamAbort.signal
      )
      if (
        stableStringifyJsonValue(input.financialBinding) !==
        stableStringifyJsonValue(pending.financialBinding)
      ) {
        throw new NativeTargetError('Original financial binding has changed', 403)
      }
      await authorizeNativeBusinessResult(scope, pending)
      command.financialBinding = pending.financialBinding
      if (input.command === 'tool.result') {
        if (input.source === 'studio_signed') {
          if (!isToolId(pending.target.toolName))
            throw new NativeTargetError('Unknown native tool', 422)
          const typed = ToolResultSchemas[pending.target.toolName].parse(input.result)
          if (stableStringifyJsonValue(typed) !== stableStringifyJsonValue(input.result)) {
            throw new NativeTargetError(
              'Final result does not match the canonical business schema',
              422
            )
          }
          await verifyCopilotToolResultProof(input.proof, {
            binding: nativeResultBinding(scope, pending),
            originalArgs: pending.originalArgs,
            result: input.result,
          })
          await authorizeNativeBusinessResult(scope, pending, input.result)
        } else {
          validateNativeBrowserAssertion(pending, input.assertion)
        }
      }
    }
    const nativeRequest = await parseNativeContract('CopilotRequest', command)
    delegated = true
    const response = await fetchNativeCopilot(nativeRequest, upstreamAbort.signal)
    if (
      response.headers.get('content-type')?.includes('text/event-stream') &&
      (!('stream' in nativeRequest) || !nativeRequest.stream)
    )
      throw new Error('Native response unexpectedly streamed')
    if (
      response.ok &&
      response.headers.get('content-type')?.includes('text/event-stream') &&
      response.body
    ) {
      return new NextResponse(
        relayNativeEvents(response.body, 'CopilotEvent', {
          requestId,
          command: nativeRequest.command,
          signal: upstreamAbort.signal,
          abortUpstream: () => upstreamAbort.abort(),
        }),
        { status: response.status, headers: SSE_HEADERS }
      )
    }
    const result = await parseNativeContract('CopilotResponse', await response.json())
    assertNativeCorrelation(result, requestId)
    assertNativeCommandResponse(nativeRequest.command, result)
    request.signal.removeEventListener('abort', abort)
    return NextResponse.json(result, { status: response.status })
  } catch (error) {
    upstreamAbort.abort()
    request.signal.removeEventListener('abort', abort)
    if (error instanceof NativeCommandResponseError)
      return NextResponse.json(error.nativeOutcome, { status: 503 })
    const status =
      error instanceof NativeTargetError || error instanceof CopilotSourceError
        ? error.status
        : delegated
          ? 503
          : 422
    const code =
      status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : delegated
            ? 'UNCERTAIN'
            : status >= 500
              ? 'DEPENDENCY_UNAVAILABLE'
              : 'INVALID_REQUEST'
    return NextResponse.json(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: delegated ? 'failed' : 'refused',
        error: {
          code,
          message: delegated
            ? 'Native Copilot outcome could not be verified'
            : error instanceof NativeTargetError || error instanceof CopilotSourceError
              ? error.message
              : 'Native command could not be authorized or validated',
          retryable: false,
          uncertain: delegated,
        },
      },
      { status }
    )
  }
}
