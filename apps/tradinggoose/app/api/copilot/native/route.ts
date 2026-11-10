import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { executeCopilotCommand } from '@/lib/copilot/agent/service'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { replaceCopilotWorkspaceEntityMentionsWithIds } from '@/lib/copilot/chat-contexts'
import { MAX_COPILOT_CONTEXTS_PER_TURN } from '@/lib/copilot/context-limits'
import { type CopilotToolContext, parseNativeContract } from '@/lib/copilot/native/contract'
import { prepareNativeImageParts } from '@/lib/copilot/native/images'
import { parseStudioNativeCommand } from '@/lib/copilot/native/studio-request'
import { authorizeNativeConversationScope, NativeTargetError } from '@/lib/copilot/native/target'
import { processContextsServer } from '@/lib/copilot/process-contents'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { collectCopilotToolContexts } from '@/lib/copilot/tool-context'
import { CopilotSourceError } from '@/lib/uploads/contexts/copilot/source-proof'

async function validateToolContext(
  context: CopilotToolContext,
  actorUserId: string
): Promise<CopilotToolContext> {
  if (context.workspaceId) await authorizeNativeConversationScope(actorUserId, context.workspaceId)
  if (!!context.contextEntityKind !== !!context.contextEntityId)
    throw new NativeTargetError('Tool context requires an entity kind and ID together', 422)
  if (!context.contextEntityKind || !context.contextEntityId) return context
  const { verifySavedEntityContext } = await import('@/lib/copilot/tools/server/entities/shared')
  const resolved = await verifySavedEntityContext(
    { ...context, userId: actorUserId },
    context.contextEntityKind,
    context.contextEntityId,
    'read'
  )
  return { ...context, workspaceId: resolved.workspaceId }
}

export async function POST(request: NextRequest) {
  let requestId = crypto.randomUUID()
  try {
    const session = await getSession()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await parseStudioNativeCommand(await request.json())
    requestId = input.requestId
    const scope = await authorizeNativeConversationScope(session.user.id, input.workspaceId)
    const { workspaceId: _workspaceId, ...fields } = input
    let command: Record<string, unknown> = { ...fields, scope }
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
      const { fileAttachments: _attachments, ...message } = fields as typeof input
      command = { ...message, scope }
      if (input.fileAttachments?.length) {
        const { authorizeCopilotAttachments } = await import(
          '@/lib/uploads/contexts/copilot/copilot-file-manager'
        )
        await authorizeCopilotAttachments(
          input.fileAttachments,
          { actorUserId: session.user.id, workspaceId: scope.workspaceId },
          request.signal
        )
      }
      const contexts = z
        .array(ChatContextSchema)
        .max(MAX_COPILOT_CONTEXTS_PER_TURN)
        .parse(input.input.contexts ?? [])
      const candidates = collectCopilotToolContexts(contexts)
      for (const requested of input.toolContexts ?? []) {
        if (
          !candidates.some(
            (candidate) =>
              candidate.contextEntityKind === requested.contextEntityKind &&
              candidate.contextEntityId === requested.contextEntityId &&
              (!requested.workspaceId || requested.workspaceId === candidate.workspaceId)
          )
        )
          throw new NativeTargetError(
            'Tool context is outside the submitted conversation context',
            422
          )
      }
      const toolContexts: CopilotToolContext[] = []
      for (const candidate of candidates)
        toolContexts.push(await validateToolContext(candidate, scope.actorUserId))
      command.toolContexts = toolContexts
      if (input.toolContext?.contextEntityId) {
        const primary = toolContexts.find(
          (candidate) =>
            candidate.contextEntityKind === input.toolContext?.contextEntityKind &&
            candidate.contextEntityId === input.toolContext?.contextEntityId
        )
        if (!primary)
          throw new NativeTargetError(
            'Primary tool context is outside the submitted conversation context',
            422
          )
        command.toolContext = primary
      } else if (input.toolContext) {
        command.toolContext = await validateToolContext(input.toolContext, scope.actorUserId)
      }
      const text = replaceCopilotWorkspaceEntityMentionsWithIds(input.input.content, contexts)
      const resolvedContexts = await processContextsServer(
        contexts,
        session.user.id,
        text,
        scope.workspaceId ?? undefined,
        { signal: request.signal }
      )
      const images = input.fileAttachments?.length
        ? await prepareNativeImageParts(input.fileAttachments, scope, requestId, request.signal)
        : []
      command.input = {
        ...input.input,
        content: images.length ? [{ type: 'text', text }, ...images] : text,
        contexts: resolvedContexts,
      }
    } else if (input.command === 'context.compact') {
      z.enum(COPILOT_RUNTIME_MODELS).parse(input.model)
    }
    return await executeCopilotCommand(
      await parseNativeContract('CopilotRequest', command),
      request.signal
    )
  } catch (error) {
    const status =
      error instanceof NativeTargetError || error instanceof CopilotSourceError ? error.status : 422
    return NextResponse.json(
      {
        requestId,
        status: 'refused',
        error: {
          code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST',
          message:
            error instanceof NativeTargetError || error instanceof CopilotSourceError
              ? error.message
              : 'Copilot command could not be authorized or validated',
          retryable: false,
          uncertain: false,
        },
      },
      { status }
    )
  }
}
