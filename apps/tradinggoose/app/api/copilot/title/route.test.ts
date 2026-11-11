/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  scope: vi.fn(),
  thread: vi.fn(),
  history: vi.fn(),
  title: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: m.session }))
vi.mock('@/lib/copilot/native/target', () => ({
  NativeTargetError: class NativeTargetError extends Error {
    constructor(
      message: string,
      public status = 409
    ) {
      super(message)
    }
  },
  authorizeNativeConversationScope: m.scope,
}))
vi.mock('@/lib/copilot/native/history', () => ({
  readNativeThread: m.thread,
  readNativeThreadHistory: m.history,
}))
vi.mock('@/lib/copilot/agent/utils', () => ({ requestCopilotTitle: m.title }))
const scope = { actorUserId: 'actual-member', workspaceId: null }
const first = {
  id: 'message',
  role: 'user',
  createdAt: '2026-11-08T00:00:00.000Z',
  parts: [
    { type: 'text', text: 'Exact first message' },
    { type: 'reasoning', text: 'private omitted' },
  ],
}
const completed = {
  status: 'completed',
  runId: 'title-run',
  text: 'Title',
}
const titleRequest = {
  workspaceId: null,
  threadId: 'original-thread',
  model: 'test/model',
  originalInput: '  Original input\n<tag>exact</tag>  ',
}
async function post(body: unknown = titleRequest, signal?: AbortSignal) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.test/api/copilot/title', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    })
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'actual-member' } })
  m.scope.mockResolvedValue(scope)
  m.thread.mockResolvedValue({ id: 'original-thread', title: '' })
  m.history.mockResolvedValue([first])
  m.title.mockImplementation(async (input) => {
    return 'Title'
  })
})
describe('actual first-thread title utility boundary', () => {
  it('confirms canonical untitled thread and one actual user, then uses exact captured original input', async () => {
    const result = await post()
    expect(await result.json()).toEqual({ title: 'Title' })
    expect(m.scope).toHaveBeenCalledWith('actual-member', null)
    expect(m.history).toHaveBeenCalledWith(scope, 'original-thread', expect.any(AbortSignal))
    expect(m.thread).toHaveBeenCalledWith(scope, 'original-thread', expect.any(AbortSignal))
    expect(m.title).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: titleRequest.originalInput,
        userId: 'actual-member',
        workspaceId: null,
        model: 'test/model',
        signal: expect.any(AbortSignal),
      })
    )
    expect(m.history.mock.invocationCallOrder[0]).toBeLessThan(m.title.mock.invocationCallOrder[0]!)
  })
  it.each([[], [first, { ...first, id: 'second' }]].map((history) => ({ history })))(
    'does not infer title for absent/later initial interaction %j',
    async ({ history }) => {
      m.history.mockResolvedValue(history)
      expect(await (await post()).json()).toEqual({ title: null })
      expect(m.title).not.toHaveBeenCalled()
    }
  )
  it('refuses caller supplied message/scope/model overrides without inference', async () => {
    expect(
      (
        await post({
          ...titleRequest,
          message: 'forged',
        })
      ).status
    ).toBe(422)
    expect((await post({ ...titleRequest, model: '' })).status).toBe(422)
    expect(m.title).not.toHaveBeenCalled()
  })
  it('passes a dynamic model identity to the authorized completion utility', async () => {
    expect((await post({ ...titleRequest, model: 'openai/new-admin-model' })).status).toBe(200)
    expect(m.title).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/new-admin-model' })
    )
  })
  it('denies unauthorized or unavailable history without paid contact or guessed thread', async () => {
    m.history.mockRejectedValueOnce(new Error('Unknown thread'))
    expect((await post()).status).toBe(422)
    expect(m.title).not.toHaveBeenCalled()
    m.session.mockResolvedValueOnce(null)
    expect((await post()).status).toBe(401)
  })
  it('keeps received acceptance when optional title does not complete and never retries', async () => {
    m.title.mockImplementationOnce(async (input) => {
      return null
    })
    expect(await (await post()).json()).toEqual({ title: null })
    expect(m.title).toHaveBeenCalledOnce()
  })
  it.each(['New Chat', 'Untitled', ' ', '\n', 'Manual title'])(
    'does not treat canonical %j as an absent title',
    async (title) => {
      m.thread.mockResolvedValueOnce({ id: 'original-thread', title })
      expect(await (await post()).json()).toEqual({ title: null })
      expect(m.history).not.toHaveBeenCalled()
      expect(m.title).not.toHaveBeenCalled()
    }
  )
  it('does not infer a missing or unavailable canonical thread', async () => {
    m.thread.mockResolvedValueOnce(undefined)
    expect(await (await post()).json()).toEqual({ title: null })
    m.thread.mockRejectedValueOnce(new Error('Unavailable list'))
    expect((await post()).status).toBe(422)
    expect(m.title).not.toHaveBeenCalled()
  })
  it.each(['', '   ', '\n'])(
    'keeps empty original prompt %j free of utility contact',
    async (originalInput) => {
      expect(await (await post({ ...titleRequest, originalInput })).json()).toEqual({ title: null })
      expect(m.title).not.toHaveBeenCalled()
    }
  )
  it('rejects caller image parts and requires captured ordinary text', async () => {
    expect(
      (await post({ ...titleRequest, originalInput: [{ type: 'text', text: 'wrong lane' }] }))
        .status
    ).toBe(422)
    const { originalInput: _missing, ...missing } = titleRequest
    expect((await post(missing)).status).toBe(422)
    expect(m.title).not.toHaveBeenCalled()
  })
  it('retains accepted facts but publishes no title after cancellation and never retries', async () => {
    const controller = new AbortController()
    m.title.mockImplementationOnce(async (input) => {
      controller.abort()
      return 'Late title'
    })
    expect(await (await post(titleRequest, controller.signal)).json()).toEqual({
      title: null,
    })
    expect(m.title).toHaveBeenCalledOnce()
  })
})
