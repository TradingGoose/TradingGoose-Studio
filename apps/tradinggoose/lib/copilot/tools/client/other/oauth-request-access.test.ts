import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '../base-tool'
import { OAuthRequestAccessClientTool } from './oauth-request-access'

const m = vi.hoisted(() => ({
  assertion: vi.fn(),
  pending: vi.fn(),
  failure: vi.fn(),
  open: vi.fn(),
  replace: vi.fn(),
  close: vi.fn(),
  sync: vi.fn(),
  abort: new AbortController(),
}))
vi.mock('../manager', () => ({ syncToolState: m.sync }))
vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({
      currentChat: { workspaceId: null },
      abortController: m.abort,
      readPendingTool: m.pending,
      submitBrowserAssertion: m.assertion,
      recordToolFailure: m.failure,
      syncToolState: m.sync,
    }),
  }),
}))
vi.mock('@/lib/oauth/oauth', () => ({
  OAUTH_PROVIDERS: { google: { services: { 'google-drive': { name: 'Google Drive' } } } },
}))
const target = {
  threadId: 'original',
  resourceId: 'original-resource',
  runId: 'original-run',
  toolCallId: 'oauth',
  toolName: 'oauth_request_access',
}
let popup: {
  closed: boolean
  opener: unknown
  location: { replace: typeof m.replace }
  close: typeof m.close
}
function tool() {
  const instance = new OAuthRequestAccessClientTool('oauth')
  instance.setExecutionContext({
    toolCallId: 'oauth',
    toolName: target.toolName,
    workspaceId: 'original-business',
  })
  return instance
}
beforeEach(() => {
  vi.resetAllMocks()
  m.abort = new AbortController()
  popup = { closed: false, opener: {}, location: { replace: m.replace }, close: m.close }
  m.open.mockReturnValue(popup)
  m.pending.mockResolvedValue({ stage: 'result', target })
  vi.stubGlobal('window', {
    open: m.open,
    location: { origin: 'https://studio.example', pathname: '/workspace/unrelated' },
  })
})
afterEach(() => vi.unstubAllGlobals())
describe('OAuth opened UI and native acknowledgement', () => {
  it.each(['blocked', 'closed', 'navigation-failed', 'isolation-failed'])(
    '%s never asserts an opened UI or grant',
    async (kind) => {
      if (kind === 'blocked') m.open.mockReturnValue(null)
      if (kind === 'closed') popup.closed = true
      if (kind === 'navigation-failed')
        m.replace.mockImplementation(() => {
          throw new Error('blocked')
        })
      if (kind === 'isolation-failed')
        Object.defineProperty(popup, 'opener', { get: () => ({}), set: () => {} })
      const instance = tool()
      instance.prepareWindow()
      await instance.execute({ providerName: 'Google Drive' })
      expect(m.assertion).not.toHaveBeenCalled()
      expect(instance.hasSubmittedResult()).toBe(false)
      expect(instance.getState()).toBe(ClientToolCallState.error)
    }
  )
  it('keeps origin alive and opener isolated while the ordinary native acknowledgement is deferred', async () => {
    let acknowledge!: () => void
    m.assertion.mockReturnValue(
      new Promise<void>((resolve) => {
        acknowledge = resolve
      })
    )
    m.replace.mockImplementation(() => {
      expect(popup.opener).toBeNull()
    })
    const instance = tool()
    instance.prepareWindow()
    const completion = instance.execute({ providerName: 'Google Drive' })
    await vi.waitFor(() => expect(m.assertion).toHaveBeenCalledOnce())
    expect(m.open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank')
    expect(m.replace).toHaveBeenCalledExactlyOnceWith(
      'https://studio.example/workspace/original-business/integrations?connect=google-drive'
    )
    expect(m.replace.mock.invocationCallOrder[0]).toBeLessThan(
      m.assertion.mock.invocationCallOrder[0]!
    )
    expect(window.location.pathname).toBe('/workspace/unrelated')
    expect(instance.getState()).toBe(ClientToolCallState.executing)
    expect(instance.hasSubmittedResult()).toBe(false)
    await instance.execute({ providerName: 'Google Drive' })
    expect(m.open).toHaveBeenCalledOnce()
    acknowledge()
    await completion
    expect(instance.getState()).toBe(ClientToolCallState.success)
    expect(instance.hasSubmittedResult()).toBe(true)
    expect(m.assertion).toHaveBeenCalledExactlyOnceWith('oauth', {
      kind: 'ui.opened',
      data: {
        opened: true,
        surface: 'integrations',
        message: 'Opened Google Drive connection dialog',
      },
    })
  })
  it('retains actual opened state on native ack failure without repeating the UI effect', async () => {
    m.assertion.mockRejectedValue(new Error('ack unavailable'))
    const instance = tool()
    instance.prepareWindow()
    await instance.execute({ providerName: 'Google Drive' })
    await instance.execute({ providerName: 'Google Drive' })
    expect(m.open).toHaveBeenCalledOnce()
    expect(m.assertion).toHaveBeenCalledOnce()
    expect(m.sync.mock.calls.some(([, , update]) => update?.result?.opened === true)).toBe(true)
    expect(m.failure).toHaveBeenCalledWith(
      'oauth',
      'Integration window opened; native acknowledgement failed'
    )
    expect(instance.hasSubmittedResult()).toBe(false)
    expect(instance.getState()).toBe(ClientToolCallState.error)
  })
  it.each(['approval', 'missing-context', 'cancelled'])(
    'refuses %s before UI contact',
    async (kind) => {
      const instance =
        kind === 'missing-context' ? new OAuthRequestAccessClientTool('oauth') : tool()
      if (kind === 'approval') m.pending.mockResolvedValue({ stage: 'approval', target })
      if (kind === 'cancelled') m.abort.abort()
      await instance.execute({ providerName: 'Google Drive' })
      expect(m.open).not.toHaveBeenCalled()
      expect(m.assertion).not.toHaveBeenCalled()
    }
  )
})
