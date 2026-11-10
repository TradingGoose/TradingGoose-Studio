import type { MemoryStorage } from '@mastra/core/storage'
import { expect, it, vi } from 'vitest'
import { admitMemoryRead, completeNativeMessages, MemoryReadBudget } from './memory-budget'
import { encodeWorkflowTransfer } from './messages'

const scope = { threadId: 'thread', resourceId: 'resource' }
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('reads all 2001 messages using explicit100 paging and exact ordering', async () => {
  const messages = encodeWorkflowTransfer(
    Array.from({ length: 2001 }, (_, i) => ({
      role: i % 3 ? ('user' as const) : ('system' as const),
      content: ` \n${i}🔥 `,
    })),
    scope,
    new Date(),
    'test'
  )
  const listMessages = vi.fn(async ({ page, perPage }) => ({
    messages: messages.slice(page * perPage, (page + 1) * perPage),
    total: messages.length,
    page,
    perPage,
    hasMore: (page + 1) * perPage < messages.length,
  }))
  const holder = vi.fn(async () => {})
  const result = await completeNativeMessages(
    { listMessages } as unknown as MemoryStorage,
    scope,
    new MemoryReadBudget(7000),
    performance.now() + 5000,
    holder
  )
  expect(result).toEqual(messages)
  expect(listMessages).toHaveBeenCalledTimes(21)
  expect(listMessages).toHaveBeenLastCalledWith(
    expect.objectContaining({
      page: 20,
      perPage: 100,
      includeTotal: true,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    })
  )
  expect(holder).toHaveBeenCalledTimes(21)
})

it('does not start a call whose whole-call reserve cannot fit', async () => {
  let now = 0
  const budget = new MemoryReadBudget(7000, undefined, () => now)
  const messages = encodeWorkflowTransfer(
    Array.from({ length: 200 }, () => ({ role: 'user' as const, content: 'x' })),
    scope,
    new Date(),
    'test'
  )
  const listMessages = vi.fn(async ({ page, perPage }) => {
    now = 1100
    return { messages: messages.slice(0, 100), total: 200, page, perPage, hasMore: true }
  })
  await expect(
    completeNativeMessages(
      { listMessages } as unknown as MemoryStorage,
      scope,
      budget,
      5000,
      async () => {}
    )
  ).rejects.toThrow('expired')
  expect(listMessages).toHaveBeenCalledTimes(1)
})

it('awaits a delayed native read, then discards late rows after holder loss without projection or next call', async () => {
  const pending = deferred()
  const budget = new MemoryReadBudget(7000)
  const listMessages = vi.fn(async () => {
    await pending.promise
    return { messages: [], total: 0, page: 0, perPage: 100, hasMore: false }
  })
  const holder = vi.fn(async () => {
    throw new Error('lock connection lost')
  })
  const read = completeNativeMessages(
    { listMessages } as unknown as MemoryStorage,
    scope,
    budget,
    performance.now() + 5000,
    holder
  )
  budget.invalidate()
  pending.resolve()
  await expect(read).rejects.toThrow('expired')
  expect(holder).not.toHaveBeenCalled()
  expect(listMessages).toHaveBeenCalledTimes(1)
})

it('never succeeds with filtered, changed, duplicate or wrong-scope native rows', async () => {
  const messages = encodeWorkflowTransfer(
    [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'a' },
    ],
    scope,
    new Date(),
    'test'
  )
  for (const page of [
    { messages: [], total: 2, hasMore: false },
    { messages: [messages[0], messages[0]], total: 2, hasMore: false },
    { messages: [{ ...messages[0], resourceId: 'copilot' }], total: 1, hasMore: false },
    { messages: [], total: 2, hasMore: true },
  ]) {
    await expect(
      completeNativeMessages(
        {
          listMessages: async () => ({ ...page, page: 0, perPage: 100 }),
        } as unknown as MemoryStorage,
        scope,
        new MemoryReadBudget(7000),
        performance.now() + 5000,
        async () => {}
      )
    ).rejects.toThrow()
  }
})

it('retains two admission slots through actual completion and rejects excess without queueing', async () => {
  const pending = deferred()
  const run = vi.fn(() => pending.promise)
  const a = admitMemoryRead(run)
  const b = admitMemoryRead(run)
  await expect(admitMemoryRead(run)).rejects.toThrow('busy')
  expect(run).toHaveBeenCalledTimes(2)
  pending.resolve()
  await Promise.all([a, b])
  await expect(admitMemoryRead(async () => 'next')).resolves.toBe('next')
})

it('keeps capacity after outer rejection until entered callbacks actually settle', async () => {
  const pending = deferred()
  const callbacks: Promise<void>[] = []
  const enter = () =>
    admitMemoryRead(async (track) => {
      callbacks.push(track(() => pending.promise))
      throw new Error('outer transaction lost')
    })
  const results = await Promise.allSettled([enter(), enter()])
  expect(results.every((result) => result.status === 'rejected')).toBe(true)
  const excess = vi.fn(async () => 'excess')
  await expect(admitMemoryRead(excess)).rejects.toThrow('busy')
  expect(excess).not.toHaveBeenCalled()
  pending.resolve()
  await Promise.all(callbacks)
  await expect(admitMemoryRead(async () => 'released')).resolves.toBe('released')
})

it('does not wait for a callback that never entered, and rejects invalid late entry before contact', async () => {
  let late!: () => Promise<void>
  const contact = vi.fn(async () => {})
  await expect(
    admitMemoryRead(async (track) => {
      late = () => track(contact)
      throw new Error('rejected before entry')
    })
  ).rejects.toThrow('before entry')
  expect(() => late()).toThrow('after its request ended')
  expect(contact).not.toHaveBeenCalled()
  await expect(admitMemoryRead(async () => 'available')).resolves.toBe('available')
})

it('observes callback rejection and synchronous failure without double-releasing capacity', async () => {
  await expect(
    admitMemoryRead(async (track) => {
      await track(async () => {
        throw new Error('callback failed')
      })
    })
  ).rejects.toThrow('callback failed')
  await expect(
    admitMemoryRead(async (track) => {
      track(() => {
        throw new Error('synchronous callback failure')
      })
    })
  ).rejects.toThrow('synchronous callback failure')
  const pending = deferred()
  const a = admitMemoryRead(() => pending.promise)
  const b = admitMemoryRead(() => pending.promise)
  await expect(admitMemoryRead(async () => undefined)).rejects.toThrow('busy')
  pending.resolve()
  await Promise.all([a, b])
})
