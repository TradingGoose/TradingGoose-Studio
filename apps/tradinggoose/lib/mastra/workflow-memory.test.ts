import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { StorageThreadType } from '@mastra/core/memory'
import { type RunFence, RunFenceConflictError } from '@mastra/core/storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWorkflowTransfer, getWorkflowMessageSource, workflowMessageDigest } from './messages'

// Synthetic public-boundary routing model, not PostgreSQL/fence conformance proof.
const seam = vi.hoisted(() => ({
  authorize: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  getThread: vi.fn(),
  createThread: vi.fn(),
  listThreads: vi.fn(),
  listMessages: vi.fn(),
  byIds: vi.fn(),
  saveThread: vi.fn(),
  saveMessages: vi.fn(),
  deleteMessages: vi.fn(),
  observed: vi.fn(),
  claim: vi.fn(),
  raise: vi.fn(),
  memoryFactory: vi.fn(),
  memoryStoreFactory: vi.fn(),
  workflowsFactory: vi.fn(),
  memorySupport: vi.fn(),
  workflowsSupport: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ workspaceId: 'workspace' }] }) }),
    }),
    transaction: (...args: unknown[]) => seam.transaction(...args),
  },
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: seam.authorize }))
vi.mock('./runtime', () => ({
  getNativeMemory: async () => {
    await seam.memoryFactory()
    return {
      getThreadById: seam.getThread,
      createThread: seam.createThread,
      listThreads: seam.listThreads,
    }
  },
  getNativeMemoryStore: async () => {
    await seam.memoryStoreFactory()
    return {
      supportsRunFencing: seam.memorySupport,
      raiseRunFence: seam.raise,
      saveThread: seam.saveThread,
      saveMessages: seam.saveMessages,
      deleteMessages: seam.deleteMessages,
      listMessages: seam.listMessages,
      listMessagesById: seam.byIds,
    }
  },
  getNativeWorkflowsStore: async () => {
    await seam.workflowsFactory()
    return {
      supportsRunFencing: seam.workflowsSupport,
      getRunOwnership: seam.observed,
      claimRunOwnership: seam.claim,
    }
  },
}))

import {
  appendWorkflowMemory,
  deleteWorkflowMemory,
  getAllWorkflowMemory,
  getWorkflowMemory,
  transferWorkflowMemory,
  workflowMemoryIdentity,
} from './workflow-memory'

const auth = { success: true, userId: 'actor' }
let threads: Map<string, StorageThreadType>
let messages: Map<string, MastraDBMessage>
let owners: Map<string, RunFence>
let fences: Map<string, RunFence>
let contacts: string[]
let generation: number
function sameFence(a: RunFence | undefined, b: RunFence) {
  return a?.generation === b.generation && a.ownerId === b.ownerId
}
function assertFence(fence: RunFence, operation: string) {
  if (!sameFence(fences.get(fence.runId), fence)) throw new RunFenceConflictError(fence, operation)
}
function seed(key: string, count = 1, date = 1000) {
  const identity = workflowMemoryIdentity('workspace', 'workflow', key)
  const thread = {
    id: identity.threadId,
    ...identity,
    title: key,
    createdAt: new Date(date),
    updatedAt: new Date(date),
  }
  threads.set(thread.id, thread)
  for (const message of encodeWorkflowTransfer(
    Array.from({ length: count }, (_, i) => ({
      role: 'user',
      content: i === 0 ? '' : `${i} 🔥\n`,
    })),
    identity,
    new Date(date),
    `seed:${key}`
  ))
    messages.set(message.id, message)
  return thread
}
beforeEach(() => {
  vi.resetAllMocks()
  threads = new Map()
  messages = new Map()
  owners = new Map()
  fences = new Map()
  contacts = []
  generation = 100
  seam.memoryFactory.mockResolvedValue(undefined)
  seam.memoryStoreFactory.mockResolvedValue(undefined)
  seam.workflowsFactory.mockResolvedValue(undefined)
  seam.memorySupport.mockResolvedValue(true)
  seam.workflowsSupport.mockResolvedValue(true)
  seam.execute.mockResolvedValue([])
  seam.transaction.mockImplementation(
    (callback: (tx: { execute: typeof seam.execute }) => Promise<unknown>) =>
      callback({ execute: seam.execute })
  )
  seam.authorize.mockResolvedValue({ ok: true, workspaceId: 'workspace' })
  seam.observed.mockImplementation(async ({ runId }) => {
    contacts.push('observe')
    return owners.get(runId) ?? null
  })
  seam.claim.mockImplementation(async ({ runId, ownerId, expectedGeneration }) => {
    contacts.push('claim')
    if ((owners.get(runId)?.generation ?? 0) !== expectedGeneration)
      return { acquired: false, record: owners.get(runId) ?? null }
    const record = {
      runId,
      ownerId,
      generation: ++generation,
      leaseExpiresAt: new Date(),
      live: true,
    }
    owners.set(runId, record)
    return { acquired: true, record }
  })
  seam.raise.mockImplementation(async (fence: RunFence) => {
    contacts.push('raise')
    fences.set(fence.runId, fence)
    return true
  })
  seam.getThread.mockImplementation(async ({ threadId }) => {
    contacts.push('lookup')
    const t = threads.get(threadId)
    return t ? { ...t } : null
  })
  seam.createThread.mockImplementation(async ({ saveThread, ...input }) => {
    expect(saveThread).toBe(false)
    return { id: input.threadId, ...input, createdAt: new Date(), updatedAt: new Date() }
  })
  seam.saveThread.mockImplementation(async ({ thread, fence }) => {
    assertFence(fence, 'saveThread')
    threads.set(thread.id, { ...thread })
    return thread
  })
  seam.listThreads.mockImplementation(async ({ page, perPage }) => {
    const all = [...threads.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)
    )
    return {
      threads: all.slice(page * perPage, (page + 1) * perPage),
      total: all.length,
      page,
      perPage,
      hasMore: (page + 1) * perPage < all.length,
    }
  })
  seam.listMessages.mockImplementation(async ({ threadId, page, perPage }) => {
    const all = [...messages.values()]
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    return {
      messages: all.slice(page * perPage, (page + 1) * perPage),
      total: all.length,
      page,
      perPage,
      hasMore: (page + 1) * perPage < all.length,
    }
  })
  seam.byIds.mockImplementation(async ({ messageIds }) => ({
    messages: messageIds.flatMap((id: string) => (messages.has(id) ? [messages.get(id)] : [])),
  }))
  seam.saveMessages.mockImplementation(
    async ({ messages: saved, fence }: { messages: MastraDBMessage[]; fence: RunFence }) => {
      assertFence(fence, 'saveMessages')
      for (const m of saved) {
        messages.set(m.id, m)
        const t = threads.get(m.threadId!)!
        threads.set(t.id, { ...t, updatedAt: new Date() })
      }
      return { messages: saved }
    }
  )
  seam.deleteMessages.mockImplementation(async (ids: string[], { fence }: { fence: RunFence }) => {
    assertFence(fence, 'deleteMessages')
    for (const id of ids) {
      const m = messages.get(id)
      if (m) {
        messages.delete(id)
        const t = threads.get(m.threadId!)!
        threads.set(t.id, { ...t, updatedAt: new Date() })
      }
    }
  })
})

describe('current reusable Memory public routing and complete logical projection', () => {
  it('claims observed absence and raises the actual returned fence before keyed lookup', async () => {
    seed('key')
    await getWorkflowMemory(auth, 'workflow', 'key')
    expect(contacts.slice(0, 4)).toEqual(['observe', 'claim', 'raise', 'lookup'])
    expect(seam.claim).toHaveBeenCalledWith(
      expect.objectContaining({ expectedGeneration: 0, force: true, ownerId: expect.any(String) })
    )
    const claim = seam.claim.mock.results[0].value
    expect(seam.raise).toHaveBeenCalledWith(
      expect.objectContaining({ generation: (await claim).record.generation })
    )
    expect(seam.claim.mock.calls[0][0].leaseMs).toBeLessThanOrEqual(6000)
  })
  it('uses the observed generation once; failed CAS never refreshes or contacts a key', async () => {
    seed('key')
    seam.observed.mockResolvedValue({
      runId: `workflow-memory-ownership:${workflowMemoryIdentity('workspace', 'workflow', 'key').threadId}`,
      generation: 91,
      ownerId: 'prior',
    })
    seam.claim.mockResolvedValue({ acquired: false, record: null })
    await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toThrow('not acquired')
    expect(seam.claim).toHaveBeenCalledOnce()
    expect(seam.claim.mock.calls[0][0].expectedGeneration).toBe(91)
    expect(seam.observed).toHaveBeenCalledOnce()
    expect(seam.raise).not.toHaveBeenCalled()
    expect(seam.getThread).not.toHaveBeenCalled()
  })
  it.each(['wrong owner', 'wrong run', 'zero generation', 'failed raise'])(
    'refuses %s before lookup',
    async (failure) => {
      const original = seam.claim.getMockImplementation()!
      seam.claim.mockImplementation(async (...args) => {
        const claimed = await original(...args)
        if (failure === 'wrong owner') claimed.record.ownerId = 'other'
        if (failure === 'wrong run') claimed.record.runId = 'other'
        if (failure === 'zero generation') claimed.record.generation = 0
        return claimed
      })
      if (failure === 'failed raise') seam.raise.mockResolvedValue(false)
      await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toThrow()
      expect(seam.getThread).not.toHaveBeenCalled()
    }
  )
  it('retains exact empty-string entry/roles/order/digests and advances logical incarnation 404→201', async () => {
    seed('key', 103)
    const before = await getWorkflowMemory(auth, 'workflow', 'key')
    expect(before.data[0]).toEqual({ role: 'user', content: '' })
    expect(before.sourceRefs).toHaveLength(103)
    const physical = threads.get(before.id)!.createdAt
    await deleteWorkflowMemory(auth, 'workflow', 'key')
    expect(seam.deleteMessages.mock.calls[0][0]).toEqual(before.sourceRefs.map((r) => r.messageId))
    expect(threads.get(before.id)!.createdAt).toEqual(physical)
    await expect(getWorkflowMemory(auth, 'workflow', 'key')).rejects.toMatchObject({ status: 404 })
    expect(await getAllWorkflowMemory(auth, 'workflow')).toEqual([])
    const next = await appendWorkflowMemory(auth, 'workflow', 'key', {
      role: 'assistant',
      content: ' recreated\n',
    })
    expect(next.created).toBe(true)
    expect(next.record.data).toEqual([{ role: 'assistant', content: ' recreated\n' }])
    expect(next.record.createdAt.getTime()).toBeGreaterThan(physical.getTime())
    expect(threads.get(before.id)!.createdAt).toEqual(physical)
    for (const call of seam.saveMessages.mock.calls)
      expect(call[0].fence).toMatchObject({
        generation: expect.any(Number),
        ownerId: expect.any(String),
      })
  })
  it('fences pure thread construction, append and transfer with original source identities', async () => {
    const appended = await appendWorkflowMemory(auth, 'workflow', 'new', {
      role: 'system',
      content: '',
    })
    expect(appended.created).toBe(true)
    expect(seam.saveThread).toHaveBeenCalledOnce()
    const empty = seed('transfer', 0)
    const source = { id: 'original-source', createdAt: new Date(2000) }
    const data = [{ role: 'assistant' as const, content: ' exact 🔥\n' }]
    const transferred = await transferWorkflowMemory(auth, 'workflow', 'transfer', data, source)
    expect(transferred.data).toEqual(data)
    expect(transferred.createdAt).toEqual(source.createdAt)
    expect(threads.get(empty.id)!.createdAt).toEqual(empty.createdAt)
    expect(seam.saveThread).toHaveBeenCalledOnce()
    const writeCount = seam.saveMessages.mock.calls.length
    expect(
      (await transferWorkflowMemory(auth, 'workflow', 'transfer', data, source)).sourceRefs
    ).toEqual(transferred.sourceRefs)
    expect(seam.saveMessages.mock.calls.length).toBe(writeCount)
    await expect(
      transferWorkflowMemory(
        auth,
        'workflow',
        'transfer',
        [{ role: 'user', content: 'different' }],
        source
      )
    ).rejects.toThrow('differs')
  })
  it('reuses verified domains only within each held transaction while claiming and reading every current key', async () => {
    for (const key of ['a', 'b', 'c']) seed(key)
    const counters = () => ({
      memory: seam.memoryFactory.mock.calls.length,
      store: seam.memoryStoreFactory.mock.calls.length,
      workflows: seam.workflowsFactory.mock.calls.length,
      memorySupport: seam.memorySupport.mock.calls.length,
      workflowsSupport: seam.workflowsSupport.mock.calls.length,
      observe: seam.observed.mock.calls.length,
      claim: seam.claim.mock.calls.length,
      raise: seam.raise.mock.calls.length,
      thread: seam.getThread.mock.calls.length,
      messages: seam.listMessages.mock.calls.length,
    })
    const transactions: ReturnType<typeof counters>[] = []
    seam.transaction.mockImplementation(
      async (callback: (tx: { execute: typeof seam.execute }) => Promise<unknown>) => {
        const before = counters()
        const value = await callback({ execute: seam.execute })
        const after = counters()
        transactions.push({
          memory: after.memory - before.memory,
          store: after.store - before.store,
          workflows: after.workflows - before.workflows,
          memorySupport: after.memorySupport - before.memorySupport,
          workflowsSupport: after.workflowsSupport - before.workflowsSupport,
          observe: after.observe - before.observe,
          claim: after.claim - before.claim,
          raise: after.raise - before.raise,
          thread: after.thread - before.thread,
          messages: after.messages - before.messages,
        })
        return value
      }
    )
    expect((await getAllWorkflowMemory(auth, 'workflow')).map(({ key }) => key)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(transactions).toHaveLength(5)
    expect(transactions[0]).toEqual({
      memory: 1,
      store: 1,
      workflows: 1,
      memorySupport: 1,
      workflowsSupport: 1,
      observe: 3,
      claim: 3,
      raise: 3,
      thread: 3,
      messages: 3,
    })
    for (const transaction of transactions.slice(1, 4))
      expect(transaction).toEqual({
        memory: 1,
        store: 1,
        workflows: 1,
        memorySupport: 1,
        workflowsSupport: 1,
        observe: 1,
        claim: 1,
        raise: 1,
        thread: 2,
        messages: 1,
      })
    expect(transactions[4]).toEqual({
      memory: 0,
      store: 0,
      workflows: 0,
      memorySupport: 0,
      workflowsSupport: 0,
      observe: 0,
      claim: 0,
      raise: 0,
      thread: 0,
      messages: 0,
    })
    expect(seam.claim).toHaveBeenCalledTimes(6)
    expect(seam.raise).toHaveBeenCalledTimes(6)
    expect(seam.getThread).toHaveBeenCalledTimes(9)
    expect(seam.listMessages.mock.calls.filter(([input]) => input.perPage === 1)).toHaveLength(3)
    expect(seam.listMessages.mock.calls.filter(([input]) => input.perPage === 100)).toHaveLength(3)
  })
  it.each([
    'memoryFactory',
    'memoryStoreFactory',
    'workflowsFactory',
    'memorySupport',
    'workflowsSupport',
  ] as const)(
    'refuses cancellation during %s initialization before claiming a key or reading presence',
    async (stage) => {
      seed('key')
      const controller = new AbortController()
      seam[stage].mockImplementationOnce(async () => {
        controller.abort()
        return true
      })
      await expect(getAllWorkflowMemory(auth, 'workflow', controller.signal)).rejects.toMatchObject(
        { status: 503 }
      )
      expect(seam[stage]).toHaveBeenCalledOnce()
      expect(seam.observed).not.toHaveBeenCalled()
      expect(seam.claim).not.toHaveBeenCalled()
      expect(seam.raise).not.toHaveBeenCalled()
      expect(seam.getThread).not.toHaveBeenCalled()
      expect(seam.listMessages).not.toHaveBeenCalled()
      // Failed initialization does not survive into an independently authorized transaction.
      await getWorkflowMemory(auth, 'workflow', 'key')
      expect(seam[stage]).toHaveBeenCalledTimes(2)
      expect(seam.claim).toHaveBeenCalledOnce()
      expect(seam.raise).toHaveBeenCalledOnce()
    }
  )
  it.each(['memorySupport', 'workflowsSupport'] as const)(
    'rejects unsupported %s without caching successful initialization for another transaction',
    async (stage) => {
      seed('key')
      seam[stage].mockResolvedValueOnce(false)
      await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow(
        'ownership support is required'
      )
      expect(seam.claim).not.toHaveBeenCalled()
      expect(seam.raise).not.toHaveBeenCalled()
      expect(seam.getThread).not.toHaveBeenCalled()
      expect(seam.listMessages).not.toHaveBeenCalled()
      await getWorkflowMemory(auth, 'workflow', 'key')
      expect(seam.memoryStoreFactory).toHaveBeenCalledTimes(2)
      expect(seam.workflowsFactory).toHaveBeenCalledTimes(2)
      expect(seam.memorySupport).toHaveBeenCalledTimes(2)
      expect(seam.workflowsSupport).toHaveBeenCalledTimes(2)
      expect(seam.claim).toHaveBeenCalledOnce()
    }
  )
  it('refuses the next cached-domain ownership lookup after presence projection expires its holder', async () => {
    seed('a')
    seed('b')
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const original = seam.listMessages.getMockImplementation()!
    seam.listMessages.mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      const message = { ...result.messages[0] }
      const createdAt = message.createdAt
      Object.defineProperty(message, 'createdAt', {
        get: () => {
          now = 5001
          return createdAt
        },
      })
      return { ...result, messages: [message] }
    })
    try {
      await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toMatchObject({ status: 503 })
      expect(seam.observed).toHaveBeenCalledOnce()
      expect(seam.claim).toHaveBeenCalledOnce()
      expect(seam.raise).toHaveBeenCalledOnce()
      expect(seam.listMessages).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }
  })
  it('retains the actual holder probe after domain factory initialization and refuses later contacts on loss', async () => {
    seed('key')
    seam.workflowsFactory.mockImplementationOnce(async () => {
      seam.execute.mockRejectedValueOnce(new Error('application holder lost during initialization'))
    })
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow(
      'holder lost during initialization'
    )
    expect(seam.memorySupport).not.toHaveBeenCalled()
    expect(seam.workflowsSupport).not.toHaveBeenCalled()
    expect(seam.observed).not.toHaveBeenCalled()
    expect(seam.claim).not.toHaveBeenCalled()
    expect(seam.raise).not.toHaveBeenCalled()
    expect(seam.getThread).not.toHaveBeenCalled()
    expect(seam.listMessages).not.toHaveBeenCalled()
    await getWorkflowMemory(auth, 'workflow', 'key')
    expect(seam.workflowsFactory).toHaveBeenCalledTimes(2)
    expect(seam.memorySupport).toHaveBeenCalledOnce()
    expect(seam.claim).toHaveBeenCalledOnce()
  })
  it('omits 51 empty containers, exhausts physical pages and selects true first50 logical keys', async () => {
    for (let i = 0; i < 51; i++) seed(`empty-${i}`, 0, i + 1)
    const retained = seed('recreated-old-container', 0, 100)
    for (let i = 0; i < 51; i++) seed(`live-${String(i).padStart(2, '0')}`, 1, 1000 + i)
    for (const message of encodeWorkflowTransfer(
      [{ role: 'user', content: 'later' }],
      retained,
      new Date(9000),
      'recreated'
    ))
      messages.set(message.id, message)
    const result = await getAllWorkflowMemory(auth, 'workflow')
    expect(result).toHaveLength(50)
    expect(result.map((r) => r.key)).toEqual(
      Array.from({ length: 50 }, (_, i) => `live-${String(i).padStart(2, '0')}`)
    )
    expect(seam.listThreads).toHaveBeenCalledTimes(3)
    const presence = seam.listMessages.mock.calls.filter(([input]) => input.perPage === 1)
    expect(presence).toHaveLength(103)
    expect(presence.map(([input]) => input.threadId).sort()).toEqual([...threads.keys()].sort())
    for (const [input] of presence)
      expect(input).toEqual({
        threadId: expect.any(String),
        resourceId: retained.resourceId,
        page: 0,
        perPage: 1,
        includeTotal: true,
        orderBy: { field: 'createdAt', direction: 'ASC' },
      })
    // All physical candidates need presence; only the chosen first50 need full histories.
    expect(seam.claim).toHaveBeenCalledTimes(103 + 50)
    expect(seam.listMessages.mock.calls.filter(([input]) => input.perPage === 100)).toHaveLength(50)
    expect(result[0].data).toEqual([{ role: 'user', content: '' }])
  })
  it('never requests the excluded 51st complete history even when that history would fail', async () => {
    for (let i = 0; i < 50; i++) seed(`selected-${String(i).padStart(2, '0')}`, 1, 1000 + i)
    const excluded = seed('excluded-long-history', 201, 9000)
    const list = seam.listMessages.getMockImplementation()!
    seam.listMessages.mockImplementation(async (input) => {
      if (input.threadId === excluded.id && input.perPage !== 1)
        throw new Error('excluded complete history must never be contacted')
      return list(input)
    })
    const result = await getAllWorkflowMemory(auth, 'workflow')
    expect(result.map(({ key }) => key)).toEqual(
      Array.from({ length: 50 }, (_, i) => `selected-${String(i).padStart(2, '0')}`)
    )
    expect(
      seam.listMessages.mock.calls.filter(([input]) => input.threadId === excluded.id)
    ).toEqual([[expect.objectContaining({ perPage: 1 })]])
    expect(seam.claim).toHaveBeenCalledTimes(51 + 50)
  })
  it('fails the whole chosen buffer when key50 disappears and never refills from key51', async () => {
    for (let i = 0; i < 51; i++) seed(`key-${String(i).padStart(2, '0')}`, 1, 1000 + i)
    const chosen = workflowMemoryIdentity('workspace', 'workflow', 'key-49')
    const excluded = workflowMemoryIdentity('workspace', 'workflow', 'key-50')
    const transaction = seam.transaction.getMockImplementation()!
    let entered = 0
    seam.transaction.mockImplementation(async (...args) => {
      const index = ++entered
      const result = await transaction(...args)
      if (index === 50) {
        expect(
          seam.listMessages.mock.calls.filter(([input]) => input.perPage === 100)
        ).toHaveLength(49)
        await deleteWorkflowMemory(auth, 'workflow', 'key-49')
      }
      return result
    })
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toMatchObject({ status: 404 })
    expect(threads.has(chosen.threadId)).toBe(true)
    expect(
      seam.listMessages.mock.calls.filter(([input]) => input.threadId === excluded.threadId)
    ).toEqual([[expect.objectContaining({ perPage: 1 })]])
  })
  it('omits an initially empty container without later hydration and preserves an empty text entry', async () => {
    const empty = seed('empty', 0)
    const live = seed('literal-empty-text')
    const result = await getAllWorkflowMemory(auth, 'workflow')
    expect(result.map((record) => [record.key, record.data])).toEqual([
      ['literal-empty-text', [{ role: 'user', content: '' }]],
    ])
    expect(
      seam.listMessages.mock.calls.filter(
        ([input]) => input.threadId === empty.id && input.perPage === 100
      )
    ).toEqual([])
    expect(
      seam.listMessages.mock.calls.filter(
        ([input]) => input.threadId === live.id && input.perPage === 100
      )
    ).toHaveLength(1)
  })
  it('fails the entire buffer when a confirmed live key is logically deleted after earlier hydration', async () => {
    const first = seed('a')
    const second = seed('b')
    const originalTransaction = seam.transaction.getMockImplementation()!
    let entered = 0
    let deleted = false
    seam.transaction.mockImplementation(async (...args) => {
      const index = ++entered
      const result = await originalTransaction(...args)
      // Synthetic transaction completion seam: original enumeration already established
      // both live candidates and the first complete hydration has already succeeded.
      if (index === 2) {
        expect(seam.listMessages.mock.calls).toContainEqual([
          expect.objectContaining({ threadId: first.id, perPage: 100 }),
        ])
        await deleteWorkflowMemory(auth, 'workflow', 'b')
        deleted = true
      }
      return result
    })
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toMatchObject({ status: 404 })
    expect(deleted).toBe(true)
    expect(threads.has(second.id)).toBe(true)
    expect([...messages.values()].filter((message) => message.threadId === second.id)).toEqual([])
    expect(seam.listMessages.mock.calls.filter(([input]) => input.perPage === 1)).toHaveLength(2)
  })
  it('allows complete current delete/recreate content after live selection without pinning old message IDs', async () => {
    const retained = seed('key')
    const oldIds = [...messages.keys()]
    const originalTransaction = seam.transaction.getMockImplementation()!
    let entered = 0
    seam.transaction.mockImplementation(async (...args) => {
      const index = ++entered
      const result = await originalTransaction(...args)
      if (index === 1) {
        await deleteWorkflowMemory(auth, 'workflow', 'key')
        await appendWorkflowMemory(auth, 'workflow', 'key', {
          role: 'assistant',
          content: ' current incarnation\n',
        })
      }
      return result
    })
    const result = await getAllWorkflowMemory(auth, 'workflow')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(retained.id)
    expect(result[0].data).toEqual([{ role: 'assistant', content: ' current incarnation\n' }])
    expect(result[0].sourceRefs.every((source) => !oldIds.includes(source.messageId))).toBe(true)
  })
  it.each([
    'wrong page',
    'wrong perPage',
    'negative total',
    'fractional total',
    'zero total with row',
    'missing row',
    'extra row',
    'wrong hasMore',
    'wrong scope',
    'invalid codec',
  ])('refuses %s in initial presence without starting complete hydration', async (failure) => {
    seed('key', 2)
    const original = seam.listMessages.getMockImplementation()!
    seam.listMessages.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[0].perPage !== 1) return result
      if (failure === 'wrong page') return { ...result, page: 1 }
      if (failure === 'wrong perPage') return { ...result, perPage: 100 }
      if (failure === 'negative total') return { ...result, total: -1 }
      if (failure === 'fractional total') return { ...result, total: 1.5 }
      if (failure === 'zero total with row') return { ...result, total: 0, hasMore: false }
      if (failure === 'missing row') return { ...result, messages: [] }
      if (failure === 'extra row')
        return { ...result, messages: [result.messages[0], result.messages[0]] }
      if (failure === 'wrong hasMore') return { ...result, hasMore: false }
      if (failure === 'wrong scope')
        return { ...result, messages: [{ ...result.messages[0], resourceId: 'foreign' }] }
      return {
        ...result,
        messages: [{ ...result.messages[0], content: { format: 2, parts: [] } }],
      }
    })
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow()
    expect(seam.listMessages).toHaveBeenCalledOnce()
    expect(seam.listMessages.mock.calls[0][0].perPage).toBe(1)
  })
  it('discards the whole presence baseline on a later native failure without hydrating its prefix', async () => {
    seed('a')
    const later = seed('b')
    const original = seam.listMessages.getMockImplementation()!
    seam.listMessages.mockImplementation(async (...args) => {
      if (args[0].threadId === later.id && args[0].perPage === 1)
        throw new Error('presence read failed')
      return original(...args)
    })
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow('presence read failed')
    expect(seam.listMessages).toHaveBeenCalledTimes(2)
    expect(seam.listMessages.mock.calls.every(([input]) => input.perPage === 1)).toBe(true)
  })
  it('does not refresh the original key-acquisition allowance after native enumeration', async () => {
    seed('key')
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const original = seam.listThreads.getMockImplementation()!
    seam.listThreads.mockImplementation(async (...args) => {
      const result = await original(...args)
      now = 500
      return result
    })
    try {
      await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toMatchObject({ status: 503 })
      expect(seam.claim).not.toHaveBeenCalled()
      expect(seam.listMessages).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })
  it('keeps the existing 4000ms reserve before initial presence dispatch', async () => {
    seed('key')
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const original = seam.getThread.getMockImplementation()!
    seam.getThread.mockImplementation(async (...args) => {
      const result = await original(...args)
      now = 1100
      return result
    })
    try {
      await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toMatchObject({ status: 503 })
      expect(seam.raise).toHaveBeenCalledOnce()
      expect(seam.getThread).toHaveBeenCalledOnce()
      expect(seam.listMessages).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })
  it('refuses incomplete candidate pages rather than returning a successful prefix', async () => {
    seed('key')
    seam.listThreads.mockResolvedValue({
      threads: [],
      total: 2,
      page: 0,
      perPage: 50,
      hasMore: true,
    })
    await expect(getAllWorkflowMemory(auth, 'workflow')).rejects.toThrow('pages changed')
    expect(seam.getThread).not.toHaveBeenCalled()
  })
  it('refuses foreign global message collision without append/retry', async () => {
    seed('key')
    seam.byIds.mockResolvedValue({
      messages: [{ id: 'foreign', threadId: 'foreign', resourceId: 'foreign' }],
    })
    await expect(
      appendWorkflowMemory(auth, 'workflow', 'key', { role: 'user', content: 'no write' })
    ).rejects.toThrow('already in use')
    expect(seam.saveMessages).not.toHaveBeenCalled()
  })
  it('does not turn a known stale fence rejection into acknowledgement readback', async () => {
    seed('key')
    seam.saveMessages.mockImplementation(async ({ fence }) => {
      throw new RunFenceConflictError(fence, 'saveMessages')
    })
    await expect(
      appendWorkflowMemory(auth, 'workflow', 'key', { role: 'user', content: 'stale' })
    ).rejects.toBeInstanceOf(RunFenceConflictError)
    expect(seam.listMessages).toHaveBeenCalledOnce()
    expect(seam.saveMessages).toHaveBeenCalledOnce()
  })
  it('retains once-only known append after lost acknowledgement and refuses later contacts after cancellation', async () => {
    seed('key')
    const original = seam.saveMessages.getMockImplementation()!
    seam.saveMessages.mockImplementation(async (...args) => {
      await original(...args)
      throw new Error('lost ack')
    })
    const result = await appendWorkflowMemory(auth, 'workflow', 'key', {
      role: 'user',
      content: 'known write',
    })
    expect(result.record.data.at(-1)?.content).toBe('known write')
    expect(seam.saveMessages).toHaveBeenCalledOnce()
    const abort = new AbortController()
    seam.raise.mockImplementation(async () => {
      abort.abort()
      return true
    })
    seam.getThread.mockClear()
    await expect(getWorkflowMemory(auth, 'workflow', 'key', abort.signal)).rejects.toThrow()
    expect(seam.getThread).not.toHaveBeenCalled()
  })
})

it('issues immutable ORIGINAL body/owner proofs only from a successful complete authorized read', async () => {
  seed('complete-proof', 103)
  const record = await getWorkflowMemory(auth, 'workflow', 'complete-proof')
  expect(record.data).toHaveLength(103)
  for (const [index, message] of record.data.entries()) {
    const source = getWorkflowMessageSource(message)
    expect(source?.readProof).toEqual({
      version: 1,
      workspaceId: 'workspace',
      workflowId: 'workflow',
      key: 'complete-proof',
      digest: workflowMessageDigest([message]),
    })
    expect(Object.isFrozen(source?.readProof)).toBe(true)
    expect(source?.messageId).toBe(record.sourceRefs[index].messageId)
  }
  const original = getWorkflowMessageSource(record.data[0])?.readProof?.digest
  record.data[0].content = 'changed after complete read'
  expect(getWorkflowMessageSource(record.data[0])?.readProof?.digest).toBe(original)
  expect(original).not.toBe(workflowMessageDigest([record.data[0]]))
})
