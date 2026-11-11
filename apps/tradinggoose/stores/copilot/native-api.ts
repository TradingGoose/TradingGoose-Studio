import type {
  CopilotRequest,
  CopilotResponse,
  Pending,
  Thread,
} from '@/lib/copilot/native/contract'
import type { NativeHistoryMessage } from '@/lib/mastra/messages'

export class NativeCommandError extends Error {
  constructor(readonly nativeOutcome: CopilotResponse) {
    super('error' in nativeOutcome ? nativeOutcome.error.message : 'Native command failed')
  }
}

/** Browser transport contains no service credential or upstream URL override. */
export function postNativeCommand(command: CopilotRequest, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return fetch('/api/copilot/native', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(command),
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
  const result = await readNativeCommandResponse(await postNativeCommand(command, signal))
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
export async function listNativeHistory(
  workspaceId: string | null,
  threadId: string,
  signal?: AbortSignal
): Promise<NativeHistoryMessage[]> {
  const result = await readNativeCommand({ command: 'history.read', workspaceId, threadId }, signal)
  if (result.status !== 'history') throw new Error('Copilot history is unavailable')
  return result.items
}
export async function listNativePending(
  workspaceId: string | null,
  threadId: string,
  signal?: AbortSignal
): Promise<Pending[]> {
  const result = await readNativeCommand({ command: 'pending.list', workspaceId, threadId }, signal)
  if (result.status !== 'pending_targets') throw new Error('Native pending unavailable')
  return result.items
}
