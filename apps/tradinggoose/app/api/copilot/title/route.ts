import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { completeCopilot } from '@/lib/copilot/native/completion'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { readNativeThread, readNativeThreadHistory } from '@/lib/copilot/native/history'
import { authorizeNativeConversationScope } from '@/lib/copilot/native/target'
import { TITLE_GENERATION_SYSTEM_PROMPT, TITLE_GENERATION_USER_PROMPT } from '@/lib/copilot/prompts'

const inputSchema = z
  .object({
    workspaceId: z.string().min(1).nullable(),
    threadId: z.string().min(1),
    model: z.string().min(1),
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
    if (!thread || thread.title) return NextResponse.json({ title: null })
    const history = await readNativeThreadHistory(scope, input.threadId, request.signal)
    const users = history.filter((message) => message.role === 'user')
    if (users.length !== 1 || !input.originalInput.trim()) return NextResponse.json({ title: null })
    request.signal.throwIfAborted()
    const outcome = await completeCopilot(
      {
        scope,
        purpose: 'title',
        model: input.model,
        messages: [
          { role: 'system', content: TITLE_GENERATION_SYSTEM_PROMPT },
          { role: 'user', content: TITLE_GENERATION_USER_PROMPT(input.originalInput) },
        ],
      },
      request.signal
    )
    return NextResponse.json({
      title:
        !request.signal.aborted && outcome.status === 'completed'
          ? outcome.text.trim() || null
          : null,
    })
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
