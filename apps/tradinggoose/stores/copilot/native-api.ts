import {
  assertNativeCommandResponse,
  assertNativeCorrelation,
  type CopilotResponse,
  type HistoryMessage,
  NativeCommandResponseError,
  type Page,
  type Pending,
  parseNativeContract,
  type Thread,
} from '@/lib/copilot/native/contract'
import type { StudioNativeCommand } from '@/lib/copilot/native/studio-request'

export class NativeCommandError extends Error {
  constructor(readonly nativeOutcome: CopilotResponse) {
    super('error' in nativeOutcome ? nativeOutcome.error.message : 'Native command failed')
  }
}

/** Browser transport contains no service credential or upstream URL override. */
export function postNativeCommand(command: StudioNativeCommand, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return fetch('/api/copilot/native', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(command),
    signal,
  })
}

export async function readNativeCommandResponse(command: StudioNativeCommand, response: Response) {
  const result = await parseNativeContract('CopilotResponse', await response.json())
  assertNativeCorrelation(result, command.requestId)
  try {
    assertNativeCommandResponse(command.command, result)
  } catch (error) {
    if (error instanceof NativeCommandResponseError)
      throw new NativeCommandError(error.nativeOutcome)
    throw error
  }
  if (!response.ok || result.status === 'failed' || result.status === 'refused')
    throw new NativeCommandError(result)
  return result
}

export async function readNativeCommand(command: StudioNativeCommand, signal?: AbortSignal) {
  const result = await readNativeCommandResponse(command, await postNativeCommand(command, signal))
  signal?.throwIfAborted()
  return result
}

async function completePages<T>(
  command: (page: Page) => StudioNativeCommand,
  project: (result: CopilotResponse) => { items: T[]; page: Page; hasMore: boolean },
  identity: (item: T) => string,
  signal?: AbortSignal
): Promise<T[]> {
  const items = new Map<string, T>()
  for (let page = 0; ; page++) {
    const result = project(await readNativeCommand(command({ page, perPage: 100 }), signal))
    for (const item of result.items) items.set(identity(item), item)
    if (!result.hasMore) return [...items.values()]
    if (!result.items.length) throw new Error('Copilot returned an empty page with more results')
  }
}

export function listNativeThreads(workspaceId: string | null, signal?: AbortSignal) {
  return completePages<Thread>(
    (page) => ({ command: 'threads.list', requestId: crypto.randomUUID(), workspaceId, page }),
    (result) => {
      if (result.status !== 'threads') throw new Error('Native threads unavailable')
      return result
    },
    (item) => item.id,
    signal
  )
}
export function listNativeHistory(
  workspaceId: string | null,
  threadId: string,
  signal?: AbortSignal
) {
  return completePages<HistoryMessage>(
    (page) => ({
      command: 'history.read',
      requestId: crypto.randomUUID(),
      workspaceId,
      threadId,
      page,
    }),
    (result) => {
      if (result.status !== 'history') throw new Error('Copilot history is unavailable')
      return result
    },
    (item) => item.id,
    signal
  )
}
export function listNativePending(
  workspaceId: string | null,
  threadId: string,
  signal?: AbortSignal
) {
  return completePages<Pending>(
    (page) => ({
      command: 'pending.list',
      requestId: crypto.randomUUID(),
      workspaceId,
      threadId,
      page,
    }),
    (result) => {
      if (result.status !== 'pending_targets') throw new Error('Native pending unavailable')
      return result
    },
    (item) => JSON.stringify([item.target.threadId, item.target.runId, item.target.toolCallId]),
    signal
  )
}
