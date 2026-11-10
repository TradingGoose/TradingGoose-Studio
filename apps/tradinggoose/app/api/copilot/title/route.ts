import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { type CopilotTitleOutcome, requestCopilotTitle } from '@/lib/copilot/agent/utils'
import { readNativeThread, readNativeThreadHistory } from '@/lib/copilot/native/history'
import type { StudioNativeTitleResult } from '@/lib/copilot/native/studio-title'
import { authorizeNativeConversationScope, NativeTargetError } from '@/lib/copilot/native/target'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'

const inputSchema = z
  .object({
    workspaceId: z.string().min(1).nullable(),
    threadId: z.string().min(1),
    model: z.enum(COPILOT_RUNTIME_MODELS),
    originalInput: z.string(),
  })
  .strict()

/** Stateless initial-title utility. The caller applies local edit/selection guards before explicit native thread.title. */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = inputSchema.parse(await request.json())
    const scope = await authorizeNativeConversationScope(session.user.id, input.workspaceId)
    const thread = await readNativeThread(scope, input.threadId, request.signal)
    if (!thread || thread.title !== '')
      return NextResponse.json({ title: null } satisfies StudioNativeTitleResult)
    const history = await readNativeThreadHistory(scope, input.threadId, request.signal)
    const users = history.filter((message) => message.role === 'user')
    if (users.length !== 1 || !input.originalInput.trim())
      return NextResponse.json({ title: null } satisfies StudioNativeTitleResult)
    request.signal.throwIfAborted()
    let outcome: CopilotTitleOutcome | undefined
    const title = await requestCopilotTitle({
      message: input.originalInput,
      userId: scope.actorUserId,
      workspaceId: scope.workspaceId,
      model: input.model,
      signal: request.signal,
      onOutcome: (value) => {
        outcome = value
      },
    })
    return NextResponse.json({
      title: request.signal.aborted ? null : title,
      ...(outcome ? { outcome } : {}),
    } satisfies StudioNativeTitleResult)
  } catch (error) {
    return NextResponse.json(
      {
        title: null,
        error: error instanceof NativeTargetError ? error.message : 'Initial title is unavailable',
      },
      { status: error instanceof NativeTargetError ? error.status : 422 }
    )
  }
}
