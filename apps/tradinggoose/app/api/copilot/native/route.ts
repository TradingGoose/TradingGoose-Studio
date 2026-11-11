import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { executeCopilotCommand } from '@/lib/copilot/agent/service'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { replaceCopilotWorkspaceEntityMentionsWithIds } from '@/lib/copilot/chat-contexts'
import { MAX_COPILOT_CONTEXTS_PER_TURN } from '@/lib/copilot/context-limits'
import { CopilotRequestSchema, type CopilotToolContext } from '@/lib/copilot/native/contract'
import { validateNativeImageParts } from '@/lib/copilot/native/images'
import { authorizeNativeConversationScope, NativeTargetError } from '@/lib/copilot/native/target'
import { processContextsServer } from '@/lib/copilot/process-contents'
import { collectCopilotToolContexts } from '@/lib/copilot/tool-context'

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
  try {
    const session = await getSession()
    if (!session?.user?.id)
      return NextResponse.json(
        { status: 'refused', error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      )
    const command = CopilotRequestSchema.parse(await request.json())
    const scope = await authorizeNativeConversationScope(session.user.id, command.workspaceId)
    if (command.command === 'message') {
      if (command.workflowId) {
        const workflow = await authorizeWorkflowScope(
          { success: true, userId: session.user.id },
          command.workflowId,
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
      const contexts = z
        .array(ChatContextSchema)
        .max(MAX_COPILOT_CONTEXTS_PER_TURN)
        .parse(command.input.contexts ?? [])
      const candidates = collectCopilotToolContexts(contexts)
      for (const requested of command.toolContexts ?? []) {
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
      if (command.toolContext?.contextEntityId) {
        const primary = toolContexts.find(
          (candidate) =>
            candidate.contextEntityKind === command.toolContext?.contextEntityKind &&
            candidate.contextEntityId === command.toolContext?.contextEntityId
        )
        if (!primary)
          throw new NativeTargetError(
            'Primary tool context is outside the submitted conversation context',
            422
          )
        command.toolContext = primary
      } else if (command.toolContext) {
        command.toolContext = await validateToolContext(command.toolContext, scope.actorUserId)
      }
      validateNativeImageParts(command.input.content)
      const content =
        typeof command.input.content === 'string'
          ? replaceCopilotWorkspaceEntityMentionsWithIds(command.input.content, contexts)
          : command.input.content.map((part) =>
              part.type === 'text'
                ? {
                    ...part,
                    text: replaceCopilotWorkspaceEntityMentionsWithIds(part.text, contexts),
                  }
                : part
            )
      const text =
        typeof content === 'string'
          ? content
          : content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
      const resolvedContexts = await processContextsServer(
        contexts,
        session.user.id,
        text,
        scope.workspaceId ?? undefined,
        { signal: request.signal }
      )
      command.input = {
        ...command.input,
        content,
        contexts: resolvedContexts,
      }
    }
    return await executeCopilotCommand(command, session.user.id, request.signal)
  } catch (error) {
    const status = error instanceof NativeTargetError ? error.status : 422
    return NextResponse.json(
      {
        status: 'refused',
        error: {
          code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST',
          message:
            error instanceof NativeTargetError
              ? error.message
              : 'Copilot command could not be authorized or validated',
        },
      },
      { status }
    )
  }
}
