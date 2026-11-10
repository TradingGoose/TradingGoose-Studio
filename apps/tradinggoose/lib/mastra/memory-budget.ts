import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { MemoryStorage } from '@mastra/core/storage'
import { assertMessageScope, type NativeMessageScope } from './messages'

export class WorkflowMemoryError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message)
  }
}

export class MemoryReadBudget {
  private invalid = false
  readonly deadline: number
  constructor(
    milliseconds: number,
    readonly signal?: AbortSignal,
    readonly now = () => performance.now(),
    startedAt = now()
  ) {
    this.deadline = startedAt + milliseconds
  }
  invalidate() {
    this.invalid = true
  }
  check(heldDeadline = this.deadline, reserve = 0): void {
    if (
      this.signal?.aborted ||
      this.invalid ||
      this.now() + reserve >= Math.min(this.deadline, heldDeadline)
    )
      throw new WorkflowMemoryError(
        'Complete Memory read expired or was canceled; retry the whole request',
        503
      )
  }
}

let admittedReads = 0
export type MemoryReadCallbackTracker = <T>(run: () => Promise<T>) => Promise<T>

/** No queue; outer transaction failure does not settle an entered callback. */
export async function admitMemoryRead<T>(
  run: (track: MemoryReadCallbackTracker) => Promise<T>
): Promise<T> {
  if (admittedReads >= 2) throw new WorkflowMemoryError('Memory reads are busy; retry shortly', 503)
  admittedReads++
  let requestSettled = false
  let callbacks = 0
  let released = false
  const release = () => {
    if (requestSettled && callbacks === 0 && !released) {
      released = true
      admittedReads--
    }
  }
  const track: MemoryReadCallbackTracker = (callback) => {
    if (requestSettled)
      throw new WorkflowMemoryError('Memory read transaction entered after its request ended', 503)
    callbacks++
    const settled = () => {
      callbacks--
      release()
    }
    let task: ReturnType<typeof callback>
    try {
      task = callback()
    } catch (error) {
      settled()
      throw error
    }
    // Observe both outcomes without creating an unhandled rejecting cleanup promise.
    void task.then(settled, settled)
    return task
  }
  try {
    return await run(track)
  } finally {
    requestSettled = true
    release()
  }
}

export async function completeNativeMessages(
  store: MemoryStorage,
  scope: NativeMessageScope,
  budget: MemoryReadBudget,
  heldDeadline: number,
  verifyHolder: () => Promise<void>
): Promise<MastraDBMessage[]> {
  const messages: MastraDBMessage[] = []
  const seen = new Set<string>()
  let total: number | undefined
  let previous: MastraDBMessage | undefined
  for (let page = 0; ; page++) {
    budget.check(heldDeadline, 3500 + 500)
    const result = await store.listMessages({
      ...scope,
      page,
      perPage: 100,
      includeTotal: true,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    })
    budget.check(heldDeadline)
    await verifyHolder()
    budget.check(heldDeadline)
    if (
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      result.page !== page ||
      result.perPage !== 100 ||
      (total !== undefined && result.total !== total) ||
      result.messages.length > 100 ||
      (result.hasMore && result.messages.length === 0)
    )
      throw new WorkflowMemoryError('Memory changed during complete read; retry')
    total = result.total
    for (const message of result.messages) {
      budget.check(heldDeadline)
      assertMessageScope(message, scope)
      const date = new Date(message.createdAt).getTime()
      const previousDate = previous
        ? new Date(previous.createdAt).getTime()
        : Number.NEGATIVE_INFINITY
      if (
        seen.has(message.id) ||
        date < previousDate ||
        (previous && date === previousDate && message.id <= previous.id)
      )
        throw new WorkflowMemoryError('Memory message ordering or identity changed')
      seen.add(message.id)
      messages.push(message)
      previous = message
    }
    if (!result.hasMore) {
      if (messages.length !== total)
        throw new WorkflowMemoryError('Complete Memory message count mismatch')
      budget.check(heldDeadline)
      return messages
    }
    if (messages.length >= total)
      throw new WorkflowMemoryError('Invalid Memory pagination progress')
  }
}
