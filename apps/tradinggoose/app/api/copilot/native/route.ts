import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { executeCopilotCommand } from '@/lib/copilot/agent/service'
import { CopilotRequestSchema, type CopilotToolContext } from '@/lib/copilot/native/contract'
import { validateNativeImageParts } from '@/lib/copilot/native/images'
import { readCopilotRequestBody } from '@/lib/copilot/native/request-size'
import { authorizeNativeConversationScope, NativeTargetError } from '@/lib/copilot/native/target'
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
    const command = CopilotRequestSchema.parse(await readCopilotRequestBody(request))
    const scope = await authorizeNativeConversationScope(session.user.id, command.workspaceId)
    const toolContexts: CopilotToolContext[] = []
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
      const contexts = command.input.contexts ?? []
      const candidates = collectCopilotToolContexts(contexts)
      for (const candidate of candidates)
        toolContexts.push(await validateToolContext(candidate, scope.actorUserId))
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
    }
    return await executeCopilotCommand(command, session.user.id, request.signal, toolContexts)
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
