import { createHash, randomUUID } from 'node:crypto'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { StorageThreadType } from '@mastra/core/memory'
import { isRunFenceConflictError, type MemoryStorage, type RunFence } from '@mastra/core/storage'
import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import type { AuthResult } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import {
  admitMemoryRead,
  completeNativeMessages,
  MemoryReadBudget,
  type MemoryReadCallbackTracker,
  WorkflowMemoryError,
} from './memory-budget'
import {
  lockMemoryHierarchy,
  lockMemoryKeys,
  lockMemoryMessageIds,
  type MemoryTransaction,
} from './memory-locks'
import {
  decodeWorkflowMessage,
  encodeWorkflowMessage,
  type WorkflowMessage,
  workflowMemoryIdentity,
  workflowMessageDigest,
} from './messages'
import { getNativeMemory, getNativeMemoryStore, getNativeWorkflowsStore } from './runtime'
import { attachWorkflowMessageSource } from './workflow-message-source'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export { workflowMemoryIdentity } from './messages'

function assertThread(
  thread: StorageThreadType,
  workspaceId: string,
  workflowId: string,
  key: string
) {
  const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
  if (
    thread.id !== identity.threadId ||
    thread.resourceId !== identity.resourceId ||
    Object.entries(identity.metadata).some(([field, value]) => thread.metadata?.[field] !== value)
  )
    throw new WorkflowMemoryError('Native Memory ownership mismatch', 403)
  return identity
}

export type WorkflowMemoryRecord = {
  id: string
  workflowId: string
  key: string
  type: 'agent'
  data: WorkflowMessage[]
  sourceRefs: import('./workflow-message-source').WorkflowMessageSourceTransport[]
  createdAt: Date
  updatedAt: Date
}
type LockedContext = {
  tx: MemoryTransaction
  workspaceId: string
  workflowId: string
  acquireUntil: number
  heldDeadline: number
  budget: MemoryReadBudget
  probe: () => Promise<void>
  nativeKey?: { store: MemoryStorage; fence: RunFence }
  memory?: Awaited<ReturnType<typeof getNativeMemory>>
  nativeDomains?: {
    store: MemoryStorage
    workflows: Awaited<ReturnType<typeof getNativeWorkflowsStore>>
  }
}

class NativeMemoryDeletionDeferredError extends WorkflowMemoryError {
  constructor() {
    super(
      'Memory deletion is deferred until safe storage quiescence is established; stored messages have been retained',
      503
    )
  }
}

async function locked<T>(
  auth: AuthResult,
  workflowId: string,
  key: string | undefined,
  access: 'read' | 'write',
  budget: MemoryReadBudget,
  run: (context: LockedContext) => Promise<T>,
  track?: MemoryReadCallbackTracker
): Promise<T> {
  budget.check()
  const [hint] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  budget.check()
  if (!hint?.workspaceId) throw new WorkflowMemoryError('Workflow not found', 404)
  const workspaceId = hint.workspaceId
  const enteredBy = budget.now() + 500
  let entered = false
  const entryTimer = setTimeout(() => {
    if (!entered) budget.invalidate()
  }, 500)
  try {
    const result = await db
      .transaction((tx) => {
        const callback = async () => {
          entered = true
          budget.check(enteredBy)
          const heldDeadline = Math.min(budget.now() + 5000, budget.deadline)
          const hardBudget = String(
            Math.max(1, Math.min(6000, Math.floor(budget.deadline - budget.now())))
          )
          await tx.execute(
            sql`select set_config('transaction_timeout', ${hardBudget}, true), set_config('idle_in_transaction_session_timeout', ${hardBudget}, true), set_config('statement_timeout', '1000', true)`
          )
          budget.check(heldDeadline)
          const acquireUntil = await lockMemoryHierarchy(
            tx,
            workspaceId,
            workflowId,
            key,
            budget,
            heldDeadline
          )
          const scope = await authorizeWorkflowScope(auth, workflowId, access, tx)
          budget.check(heldDeadline)
          if (!scope.ok) throw new WorkflowMemoryError(scope.error, scope.status)
          if (scope.workspaceId !== workspaceId)
            throw new WorkflowMemoryError('Workflow owner changed; retry')
          const probe = async () => {
            budget.check(heldDeadline)
            // Detect loss of the independent application lock holder before projecting native rows.
            await tx.execute(sql`select 1`)
            budget.check(heldDeadline)
          }
          const context: LockedContext = {
            tx,
            workspaceId,
            workflowId,
            acquireUntil,
            heldDeadline,
            budget,
            probe,
          }
          if (key !== undefined) context.nativeKey = await acquireNativeKey(context, key)
          const value = await run(context)
          budget.check(heldDeadline, 500)
          const finalDeadline = Math.min(budget.now() + 500, heldDeadline, budget.deadline)
          await tx.execute(
            sql`select set_config('statement_timeout', ${String(Math.max(1, Math.min(100, Math.floor(finalDeadline - budget.now()))))}, true)`
          )
          const finalScope = await authorizeWorkflowScope(auth, workflowId, access, tx)
          budget.check(finalDeadline)
          if (!finalScope.ok) throw new WorkflowMemoryError(finalScope.error, finalScope.status)
          if (finalScope.workspaceId !== workspaceId)
            throw new WorkflowMemoryError('Workflow owner changed; retry')
          await tx.execute(
            sql`select set_config('statement_timeout', ${String(Math.max(1, Math.floor(finalDeadline - budget.now())))}, true)`
          )
          budget.check(finalDeadline)
          return { value, finalDeadline }
        }
        return track ? track(callback) : callback()
      })
      .catch((error) => {
        budget.invalidate()
        if (['55P03', '57014', '25P03'].includes((error as { code?: string }).code ?? ''))
          throw new WorkflowMemoryError(
            'Memory is busy or the complete-read lock expired; retry the whole request',
            503
          )
        throw error
      })
    budget.check(result.finalDeadline)
    return result.value
  } finally {
    clearTimeout(entryTimer)
  }
}

function nativeKey(context: LockedContext) {
  if (!context.nativeKey)
    throw new WorkflowMemoryError('Native key ownership was not admitted', 503)
  return context.nativeKey
}

// Trusted reusable-Memory ownership; this is not an engine Workflow run.
// Generations only come from this same factory's public Workflows claim.
async function acquireNativeKey(context: LockedContext, key: string) {
  const identity = workflowMemoryIdentity(context.workspaceId, context.workflowId, key)
  const runId = `workflow-memory-ownership:${identity.threadId}`
  const ownerId = randomUUID()
  let domains = context.nativeDomains
  if (!domains) {
    const store = await getNativeMemoryStore()
    await context.probe()
    const workflows = await getNativeWorkflowsStore()
    await context.probe()
    const memorySupported = await store.supportsRunFencing()
    await context.probe()
    const workflowsSupported = await workflows.supportsRunFencing()
    await context.probe()
    if (!memorySupported || !workflowsSupported)
      throw new WorkflowMemoryError('Native ownership support is required', 503)
    domains = { store, workflows }
    context.nativeDomains = domains
  }
  const { store, workflows } = domains
  context.budget.check(context.heldDeadline)
  const observed = await workflows.getRunOwnership({ runId })
  await context.probe()
  if (
    observed &&
    (observed.runId !== runId ||
      !Number.isSafeInteger(observed.generation) ||
      observed.generation < 1)
  )
    throw new WorkflowMemoryError('Native ownership record is invalid', 503)
  context.budget.check(context.heldDeadline, 1750 + 500)
  const claim = await workflows.claimRunOwnership({
    runId,
    ownerId,
    force: true,
    expectedGeneration: observed === null ? 0 : observed.generation,
    leaseMs: Math.max(1, Math.min(6000, Math.floor(context.heldDeadline - context.budget.now()))),
  })
  await context.probe()
  if (
    !claim.acquired ||
    claim.record.runId !== runId ||
    claim.record.ownerId !== ownerId ||
    !Number.isSafeInteger(claim.record.generation) ||
    claim.record.generation < 1
  )
    throw new WorkflowMemoryError(
      'Native ownership claim was not acquired; retry the whole request',
      503
    )
  const fence: RunFence = {
    runId: claim.record.runId,
    ownerId: claim.record.ownerId,
    generation: claim.record.generation,
  }
  const raised = await store.raiseRunFence(fence)
  await context.probe()
  if (!raised) throw new WorkflowMemoryError('Native ownership barrier was not raised', 503)
  // Keep ordering records: release/retire/lease expiry do not revoke matching late writes.
  // Native retention and store-clock ordering must outlive every possible returning writer.
  return { store, fence }
}

async function currentThread(context: LockedContext, key: string, required = true) {
  const identity = workflowMemoryIdentity(context.workspaceId, context.workflowId, key)
  context.budget.check(context.heldDeadline, 1750 + 500)
  let memory = context.memory
  if (!memory) {
    memory = await getNativeMemory()
    await context.probe()
    context.memory = memory
  }
  const thread = await memory.getThreadById({
    threadId: identity.threadId,
    resourceId: identity.resourceId,
  })
  context.budget.check(context.heldDeadline)
  await context.probe()
  if (!thread) {
    if (required) throw new WorkflowMemoryError('Memory not found', 404)
    return null
  }
  assertThread(thread, context.workspaceId, context.workflowId, key)
  return thread
}

async function hydrate(
  context: LockedContext,
  key: string,
  includeEmpty = false
): Promise<WorkflowMemoryRecord> {
  const thread = await currentThread(context, key)
  if (!thread) throw new WorkflowMemoryError('Memory not found', 404)
  const identity = assertThread(thread, context.workspaceId, context.workflowId, key)
  const messages = await completeNativeMessages(
    nativeKey(context).store,
    identity,
    context.budget,
    context.heldDeadline,
    context.probe
  )
  const data = messages.map((message) => {
    context.budget.check(context.heldDeadline)
    return decodeWorkflowMessage(message, identity)
  })
  const final = await currentThread(context, key)
  if (
    !final ||
    final.createdAt.getTime() !== thread.createdAt.getTime() ||
    final.updatedAt.getTime() !== thread.updatedAt.getTime()
  )
    throw new WorkflowMemoryError('Memory changed during complete read')
  context.budget.check(context.heldDeadline)
  if (!messages.length && !includeEmpty) throw new WorkflowMemoryError('Memory not found', 404)
  const sourceRefs = messages.map((message, index) => ({
    messageId: message.id,
    threadId: identity.threadId,
    resourceId: identity.resourceId,
    ordinal: index,
    digest: workflowMessageDigest([data[index]]),
    readProof: {
      version: 1 as const,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      key,
      digest: workflowMessageDigest([data[index]]),
    },
  }))
  // Correlation-only decode is not proof. These fresh copies escape only after locked()
  // completes the final authorization and commit checks for this COMPLETE read.
  const proved = data.map((message, index) =>
    attachWorkflowMessageSource({ role: message.role, content: message.content }, sourceRefs[index])
  )
  return {
    id: thread.id,
    workflowId: context.workflowId,
    key,
    type: 'agent',
    data: proved,
    sourceRefs,
    // A logical key is created by its first surviving actual message, not its retained container.
    createdAt: messages.length ? new Date(messages[0].createdAt) : final.createdAt,
    updatedAt: final.updatedAt,
  }
}

export async function getWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  signal?: AbortSignal,
  startedAt?: number
) {
  const budget = new MemoryReadBudget(7000, signal, undefined, startedAt)
  return admitMemoryRead(async (track) => {
    const result = await locked(
      auth,
      workflowId,
      key,
      'read',
      budget,
      (context) => hydrate(context, key),
      track
    )
    budget.check()
    return result
  })
}

export async function getAllWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  signal?: AbortSignal,
  startedAt?: number
) {
  const budget = new MemoryReadBudget(10000, signal, undefined, startedAt)
  return admitMemoryRead(async (track) => {
    const keys = await locked(
      auth,
      workflowId,
      undefined,
      'read',
      budget,
      async (context) => {
        const resourceId = workflowMemoryIdentity(context.workspaceId, workflowId, '').resourceId
        const selected: string[] = []
        const seen = new Set<string>()
        let total: number | undefined
        let previous: { date: number; id: string } | undefined
        for (let page = 0; ; page++) {
          budget.check(context.heldDeadline, 3500 + 500)
          let memory = context.memory
          if (!memory) {
            memory = await getNativeMemory()
            await context.probe()
            context.memory = memory
          }
          const result = await memory.listThreads({
            page,
            perPage: 50,
            orderBy: { field: 'createdAt', direction: 'ASC' },
            filter: {
              resourceId,
              metadata: {
                purpose: 'workflow-memory',
                workspaceId: context.workspaceId,
                workflowId,
                type: 'agent',
              },
            },
          })
          budget.check(context.heldDeadline)
          await context.probe()
          if (
            !Number.isSafeInteger(result.total) ||
            result.total < 0 ||
            result.page !== page ||
            result.perPage !== 50 ||
            (total !== undefined && result.total !== total) ||
            result.threads.length > 50 ||
            (result.hasMore && !result.threads.length)
          )
            throw new WorkflowMemoryError('Memory candidate pages changed; retry')
          total = result.total
          for (const thread of result.threads) {
            budget.check(context.heldDeadline)
            const key = thread.metadata?.key
            if (typeof key !== 'string' || !key)
              throw new WorkflowMemoryError('Invalid Memory logical key')
            assertThread(thread, context.workspaceId, workflowId, key)
            const date = new Date(thread.createdAt).getTime()
            if (
              !Number.isFinite(date) ||
              seen.has(thread.id) ||
              (previous &&
                (date < previous.date || (date === previous.date && thread.id <= previous.id)))
            )
              throw new WorkflowMemoryError('Memory candidate order or identity changed')
            seen.add(thread.id)
            selected.push(key)
            previous = { date, id: thread.id }
          }
          if (!result.hasMore) {
            if (selected.length !== total)
              throw new WorkflowMemoryError('Incomplete Memory candidate list')
            break
          }
          if (selected.length >= total)
            throw new WorkflowMemoryError('Invalid Memory candidate progress')
        }
        const sorted = selected.sort()
        await lockMemoryKeys(
          context.tx,
          context.workspaceId,
          workflowId,
          sorted,
          budget,
          context.acquireUntil
        )
        const live: { key: string; createdAt: number }[] = []
        for (const key of sorted) {
          const ownership = await acquireNativeKey(context, key)
          const keyed = { ...context, nativeKey: ownership }
          const thread = await currentThread(keyed, key)
          if (!thread) throw new WorkflowMemoryError('Memory not found', 404)
          const identity = assertThread(thread, context.workspaceId, workflowId, key)
          budget.check(context.heldDeadline, 3500 + 500)
          const result = await nativeKey(keyed).store.listMessages({
            threadId: identity.threadId,
            resourceId: identity.resourceId,
            page: 0,
            perPage: 1,
            includeTotal: true,
            orderBy: { field: 'createdAt', direction: 'ASC' },
          })
          budget.check(context.heldDeadline)
          await context.probe()
          if (
            !Number.isSafeInteger(result.total) ||
            result.total < 0 ||
            result.page !== 0 ||
            result.perPage !== 1 ||
            !Array.isArray(result.messages) ||
            result.messages.length !== Math.min(result.total, 1) ||
            result.hasMore !== result.total > 1
          )
            throw new WorkflowMemoryError('Invalid Memory candidate presence; retry')
          if (result.messages.length) {
            decodeWorkflowMessage(result.messages[0], identity)
            live.push({ key, createdAt: new Date(result.messages[0].createdAt).getTime() })
          }
        }
        // Choose from confirmed logical entries before reading complete histories. This
        // baseline is not an atomic current list: a selected key may be recreated later.
        return live
          .sort((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          .slice(0, 50)
          .map(({ key }) => key)
      },
      track
    )
    const records: WorkflowMemoryRecord[] = []
    for (const key of keys) {
      budget.check()
      const record = await locked(
        auth,
        workflowId,
        key,
        'read',
        budget,
        (context) => hydrate(context, key),
        track
      )
      records.push(record)
    }
    await locked(auth, workflowId, undefined, 'read', budget, async () => undefined, track)
    budget.check()
    return records.sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    )
  })
}

export async function appendWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  message: WorkflowMessage,
  signal?: AbortSignal,
  startedAt?: number
) {
  const budget = new MemoryReadBudget(10000, signal, undefined, startedAt)
  return locked(auth, workflowId, key, 'write', budget, async (context) => {
    let thread = await currentThread(context, key, false)
    const identity = workflowMemoryIdentity(context.workspaceId, workflowId, key)
    if (!thread) {
      budget.check(context.heldDeadline)
      const memory = await getNativeMemory()
      await context.probe()
      thread = await memory.createThread({
        threadId: identity.threadId,
        resourceId: identity.resourceId,
        title: key,
        metadata: identity.metadata,
        saveThread: false,
      })
      await context.probe()
      await nativeKey(context).store.saveThread({ thread, fence: nativeKey(context).fence })
      await context.probe()
      assertThread(thread, context.workspaceId, workflowId, key)
    }
    const { store, fence } = nativeKey(context)
    const prior = await completeNativeMessages(
      store,
      identity,
      budget,
      context.heldDeadline,
      context.probe
    )
    const created = prior.length === 0
    const lastTime = prior.length ? new Date(prior[prior.length - 1].createdAt).getTime() : 0
    const encoded = encodeWorkflowMessage(
      message,
      identity,
      new Date(Math.max(Date.now(), lastTime + 1))
    )
    await lockMemoryMessageIds(context.tx, [encoded.id])
    budget.check(context.heldDeadline, 1750 + 500)
    const collision = await store.listMessagesById({ messageIds: [encoded.id] })
    budget.check(context.heldDeadline)
    await context.probe()
    if (collision.messages.length)
      throw new WorkflowMemoryError('Memory message ID is already in use')
    let writeError: unknown
    try {
      await store.saveMessages({ messages: [encoded], fence })
    } catch (error) {
      if (isRunFenceConflictError(error)) throw error
      writeError = error
    }
    budget.check(context.heldDeadline)
    await context.probe()
    // Native commits independently. Never append with a new ID after an uncertain acknowledgement.
    const record = await hydrate(context, key)
    if (
      record.data.length !== prior.length + 1 ||
      workflowMessageDigest(record.data.slice(0, -1)) !==
        workflowMessageDigest(prior.map((entry) => decodeWorkflowMessage(entry, identity))) ||
      workflowMessageDigest(record.data.slice(-1)) !== workflowMessageDigest([message])
    )
      throw (
        writeError ??
        new WorkflowMemoryError('Memory append could not be verified; do not assume rollback', 503)
      )
    return { record, created }
  })
}

export async function deleteWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  signal?: AbortSignal,
  startedAt?: number
): Promise<void> {
  const budget = new MemoryReadBudget(7000, signal, undefined, startedAt)
  return locked(auth, workflowId, key, 'write', budget, async (context) => {
    const thread = await currentThread(context, key)
    if (!thread) throw new WorkflowMemoryError('Memory not found', 404)
    const identity = assertThread(thread, context.workspaceId, workflowId, key)
    const { store, fence } = nativeKey(context)
    const captured = await completeNativeMessages(
      store,
      identity,
      budget,
      context.heldDeadline,
      context.probe
    )
    if (!captured.length) throw new WorkflowMemoryError('Memory not found', 404)
    const before = await currentThread(context, key)
    if (
      !before ||
      before.createdAt.getTime() !== thread.createdAt.getTime() ||
      before.updatedAt.getTime() !== thread.updatedAt.getTime()
    )
      throw new WorkflowMemoryError('Memory changed before deletion; inspect the current key', 503)
    budget.check(context.heldDeadline, 1750 + 500)
    // This is the complete immutable target. Never delete the backing container, a broad
    // key predicate or any later append's fresh server-generated message ID.
    try {
      await store.deleteMessages(
        captured.map(({ id }) => id),
        { fence }
      )
    } catch {
      throw new WorkflowMemoryError(
        'Memory deletion acknowledgement is uncertain; inspect the current key before another operation',
        503
      )
    }
    budget.check(context.heldDeadline)
    await context.probe()
    const remaining = await completeNativeMessages(
      store,
      identity,
      budget,
      context.heldDeadline,
      context.probe
    )
    const final = await currentThread(context, key)
    if (!final || final.createdAt.getTime() !== thread.createdAt.getTime() || remaining.length)
      throw new WorkflowMemoryError(
        'Memory deletion readback differs; inspect the current key before another operation',
        503
      )
    budget.check(context.heldDeadline)
  })
}

/** Recheck committed owner absence under the hierarchy; preserve native rows until safe deletion is supported. */
export async function cleanupOrphanWorkflowMemory(
  workspaceId: string,
  workflowId: string
): Promise<number> {
  const budget = new MemoryReadBudget(10000)
  return db.transaction(async (tx) => {
    const heldDeadline = budget.now() + 5000
    await tx.execute(
      sql`select set_config('transaction_timeout', '6000', true), set_config('idle_in_transaction_session_timeout', '6000', true), set_config('statement_timeout', '1000', true)`
    )
    await lockMemoryHierarchy(tx, workspaceId, workflowId, undefined, budget, heldDeadline)
    const [owner] = await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
    if (owner) return 0
    const store = await getNativeMemoryStore()
    const resourceId = workflowMemoryIdentity(workspaceId, workflowId, '').resourceId
    budget.check(heldDeadline, 3500 + 500)
    const page = await store.listThreads({
      page: 0,
      perPage: 50,
      filter: { resourceId, metadata: { purpose: 'workflow-memory', workspaceId, workflowId } },
    })
    budget.check(heldDeadline)
    for (const thread of page.threads) {
      const key = thread.metadata?.key
      if (typeof key !== 'string') throw new WorkflowMemoryError('Invalid orphan Memory key')
      assertThread(thread, workspaceId, workflowId, key)
      await lockMemoryHierarchy(tx, workspaceId, workflowId, key, budget, heldDeadline)
      budget.check(heldDeadline)
    }
    // Owner absence under this application holder is not native-writer quiescence, and the
    // holder can be terminated before an independent native delete settles. Preserve rows.
    if (page.threads.length) throw new NativeMemoryDeletionDeferredError()
    return 0
  })
}

/** A bounded maintenance page; each retry rechecks the real owner under the shared hierarchy. */
export async function cleanupOrphanWorkflowMemoryPage(page = 0) {
  if (!Number.isSafeInteger(page) || page < 0)
    throw new WorkflowMemoryError('Invalid Memory cleanup page', 400)
  const store = await getNativeMemoryStore()
  const candidates = await store.listThreads({
    page,
    perPage: 100,
    filter: { metadata: { purpose: 'workflow-memory' } },
    orderBy: { field: 'createdAt', direction: 'ASC' },
  })
  const owners = new Map<string, { workspaceId: string; workflowId: string }>()
  for (const thread of candidates.threads) {
    const { workspaceId, workflowId, key } = thread.metadata ?? {}
    if (
      typeof workspaceId !== 'string' ||
      typeof workflowId !== 'string' ||
      typeof key !== 'string'
    )
      throw new WorkflowMemoryError('Malformed native Memory cleanup ownership')
    assertThread(thread, workspaceId, workflowId, key)
    owners.set(JSON.stringify([workspaceId, workflowId]), { workspaceId, workflowId })
  }
  let removed = 0
  let deferredOwners = 0
  for (const owner of owners.values()) {
    try {
      removed += await cleanupOrphanWorkflowMemory(owner.workspaceId, owner.workflowId)
    } catch (error) {
      if (!(error instanceof NativeMemoryDeletionDeferredError)) throw error
      deferredOwners++
    }
  }
  // Deletions change offset pages. Restart zero after any deletion; callers explicitly traverse live pages.
  return {
    scanned: candidates.threads.length,
    hasMore: candidates.hasMore,
    removed,
    deferredOwners,
    nextPage: removed ? 0 : candidates.hasMore ? page + 1 : 0,
  }
}

/** Offline only: no legacy runtime reader; callers supply classified source messages. */
export async function transferWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  messages: WorkflowMessage[],
  source?: { id: string; createdAt: Date }
) {
  const budget = new MemoryReadBudget(10000)
  return locked(auth, workflowId, key, 'write', budget, async (context) => {
    const identity = workflowMemoryIdentity(context.workspaceId, workflowId, key)
    let thread = await currentThread(context, key, false)
    if (thread) {
      const existing = await hydrate(context, key, true)
      if (existing.data.length) {
        if (
          existing.data.length === messages.length &&
          workflowMessageDigest(existing.data) === workflowMessageDigest(messages)
        )
          return existing
        throw new WorkflowMemoryError('Transfer destination differs; retain and classify source')
      }
    }
    const { store, fence } = nativeKey(context)
    if (!thread) {
      const memory = await getNativeMemory()
      await context.probe()
      thread = await memory.createThread({
        threadId: identity.threadId,
        resourceId: identity.resourceId,
        title: key,
        metadata: identity.metadata,
        saveThread: false,
      })
      await context.probe()
      assertThread(thread, context.workspaceId, workflowId, key)
      await store.saveThread({ thread, fence })
      await context.probe()
    }
    const { encodeWorkflowTransfer } = await import('./messages')
    const importedAt = source?.createdAt ?? new Date()
    if (!Number.isFinite(importedAt.getTime()))
      throw new WorkflowMemoryError('Source conversation timestamp is unrepresentable')
    const encoded: MastraDBMessage[] = encodeWorkflowTransfer(
      messages,
      identity,
      importedAt,
      source ? hash([context.workspaceId, workflowId, key, source.id]) : randomUUID()
    )
    if (source)
      encoded.forEach((message, ordinal) => {
        message.content.metadata = { workflowSource: { sourceId: source.id, ordinal } }
      })
    await lockMemoryMessageIds(
      context.tx,
      encoded.map((message) => message.id)
    )
    for (let offset = 0; offset < encoded.length; offset += 100) {
      budget.check(context.heldDeadline, 3500 + 500)
      const collisions = await store.listMessagesById({
        messageIds: encoded.slice(offset, offset + 100).map(({ id }) => id),
      })
      budget.check(context.heldDeadline)
      await context.probe()
      if (collisions.messages.length)
        throw new WorkflowMemoryError(
          'Transfer message IDs already exist; retain and classify source'
        )
    }
    budget.check(context.heldDeadline)
    await store.saveMessages({ messages: encoded, fence })
    await context.probe()
    const result = await hydrate(context, key, messages.length === 0)
    if (
      result.data.length !== messages.length ||
      workflowMessageDigest(result.data) !== workflowMessageDigest(messages)
    )
      throw new WorkflowMemoryError('Memory transfer readback mismatch; retain the source')
    return result
  })
}
