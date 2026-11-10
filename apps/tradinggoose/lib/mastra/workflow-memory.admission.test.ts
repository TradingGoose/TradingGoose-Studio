import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWorkflowTransfer } from './messages'

const seam = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(async () => []),
  getThreadById: vi.fn(),
  listThreads: vi.fn(),
  listMessages: vi.fn(),
  getMemory: vi.fn(),
  claim: vi.fn(),
  observed: vi.fn(),
  raise: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ workspaceId: 'workspace' }] }) }),
    }),
    transaction: (...args: unknown[]) => seam.transaction(...args),
  },
}))
vi.mock('@/lib/auth/workflow-scope', () => ({
  authorizeWorkflowScope: async () => ({ ok: true, workspaceId: 'workspace' }),
}))
vi.mock('./runtime', () => ({
  getNativeMemory: () => seam.getMemory(),
  getNativeMemoryStore: async () => ({
    listMessages: seam.listMessages,
    supportsRunFencing: async () => true,
    raiseRunFence: seam.raise,
  }),
  getNativeWorkflowsStore: async () => ({
    supportsRunFencing: async () => true,
    getRunOwnership: seam.observed,
    claimRunOwnership: seam.claim,
  }),
}))

import { getAllWorkflowMemory, getWorkflowMemory, workflowMemoryIdentity } from './workflow-memory'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const auth = { success: true, userId: 'actor' }
const tx = { execute: seam.execute, select: vi.fn() }
const thread = (key: string) => ({
  id: workflowMemoryIdentity('workspace', 'workflow', key).threadId,
  ...workflowMemoryIdentity('workspace', 'workflow', key),
  title: key,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})
type Callback = (value: typeof tx) => Promise<unknown>
let callbacks: Promise<unknown>[]
let requests: Promise<unknown>[]
let releaseNative: () => void

beforeEach(() => {
  vi.clearAllMocks()
  callbacks = []
  requests = []
  releaseNative = () => {}
  seam.execute.mockResolvedValue([])
  seam.observed.mockResolvedValue(null)
  seam.claim.mockImplementation(async ({ runId, ownerId }) => ({
    acquired: true,
    record: { runId, ownerId, generation: 100, leaseExpiresAt: new Date(), live: true },
  }))
  seam.raise.mockResolvedValue(true)
  seam.getMemory.mockResolvedValue({
    getThreadById: seam.getThreadById,
    listThreads: seam.listThreads,
  })
  seam.transaction.mockImplementation((callback: Callback) => callback(tx))
  seam.getThreadById.mockImplementation(async ({ threadId }) =>
    ['key', 'first', 'second'].map(thread).find((row) => row.id === threadId)
  )
  seam.listThreads.mockImplementation(async () => ({
    threads: [thread('first'), thread('second')].sort((a, b) => (a.id < b.id ? -1 : 1)),
    total: 2,
    page: 0,
    perPage: 50,
    hasMore: false,
  }))
  seam.listMessages.mockImplementation(async (scope) => ({
    messages: encodeWorkflowTransfer(
      [{ role: 'user', content: 'exact content' }],
      scope,
      new Date('2026-01-01T00:00:00Z'),
      'actual-input'
    ),
    total: 1,
    page: 0,
    perPage: scope.perPage,
    hasMore: false,
  }))
})
afterEach(async () => {
  releaseNative()
  await Promise.allSettled(callbacks)
  await Promise.allSettled(requests)
})

describe('actual Memory entrypoints with controlled transaction/native-read faults', () => {
  it.each(['Get', 'GetAll'] as const)(
    '%s never dispatches a native read after a delayed store lookup loses its outer transaction',
    async (entrypoint) => {
      const entered = deferred()
      const native = deferred<{
        getThreadById: typeof seam.getThreadById
        listThreads: typeof seam.listThreads
      }>()
      releaseNative = () =>
        native.resolve({ getThreadById: seam.getThreadById, listThreads: seam.listThreads })
      seam.getMemory.mockImplementation(() => {
        entered.resolve()
        return native.promise
      })
      const outer = deferred<unknown>()
      seam.transaction.mockImplementation((callback: Callback) => {
        const task = callback(tx)
        callbacks.push(task)
        void task.then(
          () => {},
          () => {}
        )
        return outer.promise
      })
      const reading =
        entrypoint === 'Get'
          ? getWorkflowMemory(auth, 'workflow', 'key')
          : getAllWorkflowMemory(auth, 'workflow')
      requests.push(reading)
      const observed = Promise.allSettled([reading])
      await entered.promise
      outer.reject(new Error('outer holder lost'))
      expect((await observed)[0].status).toBe('rejected')
      releaseNative()
      expect((await Promise.allSettled(callbacks))[0].status).toBe('rejected')
      expect(seam.getThreadById).not.toHaveBeenCalled()
      expect(seam.listThreads).not.toHaveBeenCalled()
      expect(seam.listMessages).not.toHaveBeenCalled()
    }
  )
  it.each(['Get', 'GetAll'] as const)(
    '%s retains both slots after outer rejection and discards late native rows',
    async (entrypoint) => {
      const entered = deferred()
      const pending = deferred()
      releaseNative = () => pending.resolve()
      let nativeCalls = 0
      const original =
        entrypoint === 'Get'
          ? seam.listMessages.getMockImplementation()!
          : seam.listThreads.getMockImplementation()!
      const read = async (...args: unknown[]) => {
        if (++nativeCalls === 2) entered.resolve()
        await pending.promise
        return original(...args)
      }
      if (entrypoint === 'Get') seam.listMessages.mockImplementation(read)
      else seam.listThreads.mockImplementation(read)
      const outers: ReturnType<typeof deferred<unknown>>[] = []
      seam.transaction.mockImplementation((callback: Callback) => {
        const outer = deferred<unknown>()
        outers.push(outer)
        const task = callback(tx)
        callbacks.push(task)
        void task.then(
          () => {},
          () => {}
        )
        return outer.promise
      })
      const invoke = () =>
        entrypoint === 'Get'
          ? getWorkflowMemory(auth, 'workflow', 'key')
          : getAllWorkflowMemory(auth, 'workflow')
      const a = invoke()
      const b = invoke()
      requests.push(a, b)
      const outerResults = Promise.allSettled([a, b])
      await entered.promise
      outers.forEach((outer) => outer.reject(new Error('controlled outer failure')))
      expect((await outerResults).every((result) => result.status === 'rejected')).toBe(true)
      const beforeNative = nativeCalls
      await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toThrow('busy')
      await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow('busy')
      expect(nativeCalls).toBe(beforeNative)
      expect(seam.transaction).toHaveBeenCalledTimes(2)
      releaseNative()
      const settled = await Promise.allSettled(callbacks)
      expect(settled.every((result) => result.status === 'rejected')).toBe(true)
      expect(nativeCalls).toBe(2)
      if (entrypoint === 'GetAll') expect(seam.getThreadById).not.toHaveBeenCalled()
      else expect(seam.getThreadById).toHaveBeenCalledTimes(2)
      seam.transaction.mockImplementation((callback: Callback) => callback(tx))
      await expect(getWorkflowMemory(auth, 'workflow', 'key')).resolves.toMatchObject({
        data: [{ role: 'user', content: 'exact content' }],
      })
    }
  )

  it('releases a pre-entry rejection and refuses a late callback without native contact', async () => {
    let late!: Callback
    seam.transaction.mockImplementation((callback: Callback) => {
      late = callback
      return Promise.reject(new Error('failed before callback'))
    })
    await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toThrow('before callback')
    expect(() => late(tx)).toThrow('after its request ended')
    expect(seam.getThreadById).not.toHaveBeenCalled()
    seam.transaction.mockImplementation((callback: Callback) => callback(tx))
    await expect(getAllWorkflowMemory(auth, 'workflow')).resolves.toHaveLength(2)
  })

  it('GetAll keeps one slot across sequential enumeration and hydration callbacks', async () => {
    const entered = deferred()
    const pending = deferred()
    releaseNative = () => pending.resolve()
    const original = seam.listMessages.getMockImplementation()!
    seam.listMessages.mockImplementation(async (scope) => {
      if (scope.perPage === 100 && scope.threadId === thread('second').id) {
        entered.resolve()
        await pending.promise
      }
      return original(scope)
    })
    const reading = getAllWorkflowMemory(auth, 'workflow')
    requests.push(reading)
    await entered.promise
    // The list and first hydration have settled; the whole GetAll still owns one slot.
    expect(seam.transaction).toHaveBeenCalledTimes(3)
    const second = getAllWorkflowMemory(auth, 'workflow')
    requests.push(second)
    await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toThrow('busy')
    releaseNative()
    expect(await reading).toHaveLength(2)
    expect(await second).toHaveLength(2)
    await expect(getWorkflowMemory(auth, 'workflow', 'key')).resolves.toHaveProperty('data')
  })

  it('GetAll retains both slots after outer loss until pending initial presence callbacks settle', async () => {
    const entered = deferred()
    const pending = deferred()
    releaseNative = () => pending.resolve()
    const original = seam.listMessages.getMockImplementation()!
    let presenceCalls = 0
    seam.listMessages.mockImplementation(async (scope) => {
      if (scope.perPage === 1) {
        if (++presenceCalls === 2) entered.resolve()
        await pending.promise
      }
      return original(scope)
    })
    const outers: ReturnType<typeof deferred<unknown>>[] = []
    seam.transaction.mockImplementation((callback: Callback) => {
      const outer = deferred<unknown>()
      outers.push(outer)
      const task = callback(tx)
      callbacks.push(task)
      void task.then(
        () => {},
        () => {}
      )
      return outer.promise
    })
    const a = getAllWorkflowMemory(auth, 'workflow')
    const b = getAllWorkflowMemory(auth, 'workflow')
    requests.push(a, b)
    const results = Promise.allSettled([a, b])
    await entered.promise
    outers.forEach((outer) => outer.reject(new Error('holder lost during presence')))
    expect((await results).every((result) => result.status === 'rejected')).toBe(true)
    await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toThrow('busy')
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow('busy')
    expect(presenceCalls).toBe(2)
    releaseNative()
    expect(
      (await Promise.allSettled(callbacks)).every((result) => result.status === 'rejected')
    ).toBe(true)
    expect(seam.listMessages).toHaveBeenCalledTimes(2)
    expect(seam.listMessages.mock.calls.every(([scope]) => scope.perPage === 1)).toBe(true)
    seam.transaction.mockImplementation((callback: Callback) => callback(tx))
    await expect(getAllWorkflowMemory(auth, 'workflow')).resolves.toHaveLength(2)
  })

  it('GetAll cancellation during initial presence rejects before another key or complete hydration', async () => {
    const entered = deferred()
    const pending = deferred()
    releaseNative = () => pending.resolve()
    const original = seam.listMessages.getMockImplementation()!
    seam.listMessages.mockImplementation(async (scope) => {
      entered.resolve()
      await pending.promise
      return original(scope)
    })
    const abort = new AbortController()
    const reading = getAllWorkflowMemory(auth, 'workflow', abort.signal)
    requests.push(reading)
    const outcome = Promise.allSettled([reading])
    await entered.promise
    abort.abort()
    releaseNative()
    expect((await outcome)[0].status).toBe('rejected')
    expect(seam.listMessages).toHaveBeenCalledOnce()
    expect(seam.listMessages.mock.calls[0][0].perPage).toBe(1)
    expect(seam.claim).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'native rejection'] as const)(
    'keeps callback capacity through %s and permits no further native projection',
    async (failure) => {
      const entered = deferred()
      const pending = deferred()
      releaseNative = () => pending.resolve()
      seam.listMessages.mockImplementation(async () => {
        entered.resolve()
        await pending.promise
        throw new Error('native read rejected')
      })
      const abort = new AbortController()
      const reading = getWorkflowMemory(auth, 'workflow', 'key', abort.signal)
      requests.push(reading)
      const observed = Promise.allSettled([reading])
      await entered.promise
      if (failure === 'cancel') abort.abort()
      releaseNative()
      expect((await observed)[0].status).toBe('rejected')
      expect(seam.listMessages).toHaveBeenCalledOnce()
      expect(seam.getThreadById).toHaveBeenCalledOnce()
    }
  )
})
