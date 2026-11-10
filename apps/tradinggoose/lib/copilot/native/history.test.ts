import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ thread: vi.fn(), messages: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/mastra/runtime', () => ({
  getNativeMemoryStore: async () => ({ getThreadById: state.thread, listMessages: state.messages }),
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))
vi.mock('@/lib/copilot/agent/service', () => ({ listCopilotPending: vi.fn() }))

import { readNativeThread, readNativeThreadHistory } from './history'
import { nativeConversationIdentity } from './identity'

const scope = { actorUserId: 'actor', workspaceId: 'workspace' }
beforeEach(() => {
  vi.clearAllMocks()
  state.access.mockResolvedValue({ hasAccess: true })
  state.thread.mockResolvedValue({
    id: 'thread',
    resourceId: nativeConversationIdentity(scope).resourceId,
    title: '',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
  state.messages.mockResolvedValue({ messages: [] })
})
describe('local canonical Copilot history', () => {
  it('reads native storage with actor/workspace resource scope', async () => {
    expect(await readNativeThread(scope, 'thread')).toMatchObject({ id: 'thread', title: '' })
    expect(state.thread).toHaveBeenCalledWith({
      threadId: 'thread',
      resourceId: nativeConversationIdentity(scope).resourceId,
    })
  })
  it('preserves ordered image/tool/provider parts without rewriting native storage', async () => {
    const parts = [
      { type: 'file', mimeType: 'image/png', data: 'data:image/png;base64,YQ==' },
      {
        type: 'tool-invocation',
        toolInvocation: {
          state: 'result',
          toolCallId: 'call',
          toolName: 'plan',
          args: {},
          result: { todoList: [] },
        },
        providerMetadata: { vendor: { signature: 'exact' } },
      },
    ]
    state.messages.mockResolvedValue({
      messages: [
        { id: 'message', role: 'assistant', createdAt: new Date(1), content: { format: 2, parts } },
      ],
    })
    const history = await readNativeThreadHistory(scope, 'thread')
    expect(history[0]!.parts).toBe(parts)
    expect(history[0]!.createdAt).toBe(new Date(1).toISOString())
    expect(state.messages).toHaveBeenCalledWith(
      expect.objectContaining({
        perPage: false,
        threadId: 'thread',
        resourceId: nativeConversationIdentity(scope).resourceId,
      })
    )
  })
  it('rejects revoked workspace access before native reads', async () => {
    state.access.mockResolvedValue({ hasAccess: false })
    await expect(readNativeThreadHistory(scope, 'thread')).rejects.toMatchObject({ status: 403 })
    expect(state.thread).not.toHaveBeenCalled()
  })
  it('rejects foreign/missing threads without leaking messages', async () => {
    state.thread.mockResolvedValue(null)
    await expect(readNativeThreadHistory(scope, 'foreign')).rejects.toMatchObject({ status: 404 })
    expect(state.messages).not.toHaveBeenCalled()
  })
  it('does not turn a cancelled read into successful history', async () => {
    const controller = new AbortController()
    state.messages.mockImplementation(async () => {
      controller.abort()
      return { messages: [] }
    })
    await expect(readNativeThreadHistory(scope, 'thread', controller.signal)).rejects.toThrow()
  })
})
