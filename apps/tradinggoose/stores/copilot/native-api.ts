import type { CopilotRequest, CopilotResponse, Thread } from '@/lib/copilot/native/contract'
import {
  assertCopilotRequestSize,
  serializeCopilotRequest,
} from '@/lib/copilot/native/request-size'

export class NativeCommandError extends Error {
  constructor(readonly nativeOutcome: CopilotResponse) {
    super('error' in nativeOutcome ? nativeOutcome.error.message : 'Native command failed')
  }
}

/** Browser transport contains no service credential or upstream URL override. */
export function postNativeCommand(body: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  assertCopilotRequestSize(body)
  return fetch('/api/copilot/native', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body,
    signal,
  })
}

export async function readNativeCommandResponse(response: Response) {
  const result: CopilotResponse = await response.json()
  if (!response.ok || result.status === 'failed' || result.status === 'refused')
    throw new NativeCommandError(result)
  return result
}

export async function readNativeCommand(command: CopilotRequest, signal?: AbortSignal) {
  const result = await readNativeCommandResponse(
    await postNativeCommand(serializeCopilotRequest(command), signal)
  )
  signal?.throwIfAborted()
  return result
}

export async function listNativeThreads(
  workspaceId: string | null,
  signal?: AbortSignal
): Promise<Thread[]> {
  const result = await readNativeCommand({ command: 'threads.list', workspaceId }, signal)
  if (result.status !== 'threads') throw new Error('Native threads unavailable')
  return result.items
}
