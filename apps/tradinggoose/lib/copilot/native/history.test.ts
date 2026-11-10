/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { readNativeCopilot } from './client'
import { COPILOT_NATIVE_REVISION, type HistoryMessage, type Thread } from './contract'
import { readNativeThread, readNativeThreadHistory } from './history'

vi.mock('./client', () => ({ readNativeCopilot: vi.fn() }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: vi.fn() }))
vi.mock('@/lib/copilot/registry', () => ({ isToolId: vi.fn() }))

const message = (id: string): HistoryMessage => ({
  id,
  role: 'user',
  createdAt: '2026-11-08T00:00:00.000Z',
  parts: [{ type: 'text', text: `text ${id}` }],
})
const response = (page: number, items: HistoryMessage[], hasMore: boolean) => ({
  status: 200,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId: 'validated-by-client',
    status: 'history' as const,
    threadId: 'thread-1',
    items,
    page: { page, perPage: 100 },
    hasMore,
  },
})
const read = vi.mocked(readNativeCopilot)
const access = vi.mocked(checkWorkspaceAccess)
const thread = (id: string, title = ''): Thread => ({
  id,
  title,
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
})
const threadsResponse = (page: number, items: Thread[], hasMore: boolean) => ({
  status: 200,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId: 'validated-by-client',
    status: 'threads' as const,
    items,
    page: { page, perPage: 100 },
    hasMore,
  },
})

describe('readNativeThreadHistory', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    access.mockResolvedValue({
      hasAccess: true,
      exists: true,
      canWrite: false,
      workspace: {
        id: 'workspace-1',
        name: 'Synthetic workspace',
        ownerId: 'user-1',
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-1',
        billingOwnerOrganizationId: null,
        allowPersonalApiKeys: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    })
  })

  it.each([null, 'workspace-1'])(
    'reads every page with the actual referenced workspace %s and signal',
    async (workspaceId) => {
      const first = Array.from({ length: 100 }, (_, index) => message(`message-${index}`))
      read
        .mockResolvedValueOnce(response(0, first, true))
        .mockResolvedValueOnce(response(1, [message('last')], false))
      const scope = { actorUserId: 'user-1', workspaceId }
      const signal = new AbortController().signal
      const messages = await readNativeThreadHistory(scope, 'thread-1', signal)
      expect(messages).toEqual([...first, message('last')])
      expect(read).toHaveBeenCalledTimes(2)
      for (const [index, [request, passedSignal]] of read.mock.calls.entries()) {
        expect(request).toMatchObject({
          scope,
          command: 'history.read',
          threadId: 'thread-1',
          page: { page: index, perPage: 100 },
        })
        expect(passedSignal).toBe(signal)
      }
      if (workspaceId) expect(access).toHaveBeenCalledWith(workspaceId, 'user-1')
      else expect(access).not.toHaveBeenCalled()
    }
  )

  it('refuses revoked referenced workspace access before upstream contact', async () => {
    access.mockResolvedValueOnce({
      hasAccess: false,
      exists: false,
      canWrite: false,
      workspace: null,
    })
    await expect(
      readNativeThreadHistory({ actorUserId: 'user-1', workspaceId: 'workspace-1' }, 'thread-1')
    ).rejects.toThrow('Conversation workspace access denied')
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses an absent actor or thread before reading history', async () => {
    await expect(
      readNativeThreadHistory({ actorUserId: '', workspaceId: null }, 'thread-1')
    ).rejects.toThrow('Authenticated Copilot actor is required')
    await expect(
      readNativeThreadHistory({ actorUserId: 'user-1', workspaceId: null }, '')
    ).rejects.toThrow('Native history thread is required')
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['thread', 'page', 'perPage', 'oversized', 'noProgress'])(
    'refuses inconsistent %s without returning earlier messages',
    async (failure) => {
      read.mockResolvedValueOnce(response(0, [message('first')], true))
      const second = response(1, [message('second')], false)
      if (failure === 'thread') second.result.threadId = 'another-thread'
      if (failure === 'page') second.result.page.page = 0
      if (failure === 'perPage') second.result.page.perPage = 99
      if (failure === 'oversized')
        second.result.items = Array.from({ length: 101 }, (_, index) => message(`${index}`))
      if (failure === 'noProgress') {
        second.result.items = []
        second.result.hasMore = true
      }
      read.mockResolvedValueOnce(second)
      await expect(
        readNativeThreadHistory({ actorUserId: 'user-1', workspaceId: null }, 'thread-1')
      ).rejects.toThrow('Native history pagination is inconsistent')
    }
  )

  it('refuses duplicate message identities across pages', async () => {
    read
      .mockResolvedValueOnce(response(0, [message('same')], true))
      .mockResolvedValueOnce(response(1, [message('same')], false))
    await expect(
      readNativeThreadHistory({ actorUserId: 'user-1', workspaceId: null }, 'thread-1')
    ).rejects.toThrow('Native history contains a repeated message identity')
  })

  it('preserves a page failure without a successful prefix', async () => {
    read
      .mockResolvedValueOnce(response(0, [message('first')], true))
      .mockRejectedValueOnce(new Error('Native readback unavailable'))
    await expect(
      readNativeThreadHistory({ actorUserId: 'user-1', workspaceId: null }, 'thread-1')
    ).rejects.toThrow('Native readback unavailable')
  })

  it('refuses a non-success HTTP response even with a history-shaped body', async () => {
    read.mockResolvedValueOnce({ ...response(0, [message('first')], false), status: 503 })
    await expect(
      readNativeThreadHistory({ actorUserId: 'user-1', workspaceId: null }, 'thread-1')
    ).rejects.toMatchObject({ message: 'Native history is unavailable', status: 503 })
  })

  it('checks cancellation after a completed read and never requests another page', async () => {
    const controller = new AbortController()
    const reason = new Error('Caller cancelled')
    read.mockImplementationOnce(async () => {
      controller.abort(reason)
      return response(0, [message('first')], true)
    })
    await expect(
      readNativeThreadHistory(
        { actorUserId: 'user-1', workspaceId: null },
        'thread-1',
        controller.signal
      )
    ).rejects.toBe(reason)
    expect(read).toHaveBeenCalledTimes(1)
  })
  it.each([null, 'workspace-1'])(
    'fully discovers a canonical thread in actual scope %s',
    async (workspaceId) => {
      const selected = thread('thread-1')
      read
        .mockResolvedValueOnce(threadsResponse(0, [selected], true))
        .mockResolvedValueOnce(threadsResponse(1, [thread('other', 'Manual')], false))
      const signal = new AbortController().signal
      expect(
        await readNativeThread({ actorUserId: 'user-1', workspaceId }, selected.id, signal)
      ).toEqual(selected)
      expect(read).toHaveBeenCalledTimes(2)
      for (const [page, [request, actualSignal]] of read.mock.calls.entries()) {
        expect(request).toMatchObject({
          command: 'threads.list',
          scope: { actorUserId: 'user-1', workspaceId },
          page: { page, perPage: 100 },
        })
        expect(actualSignal).toBe(signal)
      }
    }
  )
  it('does not turn absent canonical thread into invented untitled state', async () => {
    read.mockResolvedValueOnce(threadsResponse(0, [thread('other')], false))
    expect(
      await readNativeThread({ actorUserId: 'user-1', workspaceId: null }, 'missing')
    ).toBeUndefined()
  })
  it('refuses duplicate identity discovered after the selected thread rather than returning an early prefix', async () => {
    read
      .mockResolvedValueOnce(threadsResponse(0, [thread('thread-1')], true))
      .mockResolvedValueOnce(threadsResponse(1, [thread('thread-1', 'Changed')], false))
    await expect(
      readNativeThread({ actorUserId: 'user-1', workspaceId: null }, 'thread-1')
    ).rejects.toThrow('Native thread list is inconsistent')
  })
  it.each([
    threadsResponse(1, [thread('thread-1')], false),
    threadsResponse(0, [], true),
    threadsResponse(
      0,
      Array.from({ length: 101 }, (_, i) => thread(String(i))),
      false
    ),
  ])('refuses incomplete or inconsistent canonical thread pages', async (response) => {
    read.mockResolvedValueOnce(response)
    await expect(
      readNativeThread({ actorUserId: 'user-1', workspaceId: null }, 'thread-1')
    ).rejects.toThrow('Native thread pagination is inconsistent')
  })
  it('freshly refuses revoked workspace before thread listing', async () => {
    access.mockResolvedValueOnce({
      hasAccess: false,
      exists: false,
      canWrite: false,
      workspace: null,
    })
    await expect(
      readNativeThread({ actorUserId: 'user-1', workspaceId: 'workspace-1' }, 'thread-1')
    ).rejects.toThrow('Conversation workspace access denied')
    expect(read).not.toHaveBeenCalled()
  })
  it('checks abort after thread listing and never publishes its candidate', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled listing')
    read.mockImplementationOnce(async () => {
      controller.abort(reason)
      return threadsResponse(0, [thread('thread-1')], false)
    })
    await expect(
      readNativeThread({ actorUserId: 'user-1', workspaceId: null }, 'thread-1', controller.signal)
    ).rejects.toBe(reason)
  })
})
