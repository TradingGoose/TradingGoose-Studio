/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseClientTool, ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool, registerClientTool } from '@/lib/copilot/tools/client/manager'
import { buildCopilotWorkspaceChannelId } from '@/stores/copilot/channel-id'
import {
  CopilotStoreProvider,
  getCopilotStore,
  resetCopilotStoreRegistry,
} from '@/stores/copilot/store'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'
import { getCopilotWorkspaceSelection } from '@/stores/copilot/workspace-selection'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

class DeferredClientTool extends BaseClientTool {
  constructor(toolCallId: string) {
    super(toolCallId, 'sleep', { displayNames: {} })
  }
}

const channelId = (authenticatedUserId: string, workspaceId: string) =>
  buildCopilotWorkspaceChannelId({ authenticatedUserId, workspaceId })
const EMPTY_DRAFT = { text: '', contexts: [] }

describe('Copilot store lifecycle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    resetCopilotStoreRegistry()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    resetCopilotStoreRegistry()
    vi.unstubAllGlobals()
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('resets and evicts every user-owned store without starting network cleanup', async () => {
    const workspaceChannelId = channelId('user-a', 'workspace-1')
    const ownedStore = getCopilotStore(workspaceChannelId)
    const abortController = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    ownedStore.getState().setDraft({
      text: 'private @Documentation draft',
      contexts: [{ kind: 'docs', label: 'Documentation' }],
    })
    await ownedStore.getState().handleNewReviewSessionCreation('review-session-1', 'workspace-1')
    ownedStore.setState({
      abortController,
      isSendingMessage: true,
    })

    resetCopilotStoreRegistry()

    expect(abortController.signal.aborted).toBe(true)
    expect(ownedStore.getState().draft).toEqual(EMPTY_DRAFT)
    expect(getCopilotStore(workspaceChannelId)).not.toBe(ownedStore)
    expect(getCopilotWorkspaceSelection('workspace-1')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disposes stores from the previous authenticated identity after provider identity changes', async () => {
    const workspaceId = 'shared-workspace'
    const userAChannel = channelId('user-a', workspaceId)
    const userBChannel = channelId('user-b', workspaceId)
    const userAStore = getCopilotStore(userAChannel)
    const toolCallId = 'user-a-deferred-tool'
    const tool = new DeferredClientTool(toolCallId)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    registerClientTool(toolCallId, tool)
    userAStore.getState().setDraft({
      text: 'user A @Documentation draft',
      contexts: [{ kind: 'docs', label: 'Documentation' }],
    })
    userAStore.setState({
      toolCallsById: {
        [toolCallId]: {
          id: toolCallId,
          name: 'sleep',
          state: ClientToolCallState.executing,
        },
      },
    })

    await act(async () => {
      root.render(<CopilotStoreProvider channelId={userAChannel}>A</CopilotStoreProvider>)
    })
    await act(async () => {
      root.render(<CopilotStoreProvider channelId={userBChannel}>B</CopilotStoreProvider>)
    })

    expect(userAStore.getState().draft).toEqual(EMPTY_DRAFT)
    expect(getCopilotStore(userBChannel).getState().draft).toEqual(EMPTY_DRAFT)
    expect(getCopilotStore(userAChannel)).not.toBe(userAStore)
    expect(getClientTool(toolCallId)).toBeUndefined()
    expect(tool.getState()).toBe(ClientToolCallState.aborted)
    expect(() => getCopilotStoreForToolCall(toolCallId)).toThrow(
      `No active Copilot store owns tool call ${toolCallId}`
    )
    await expect(tool.markToolComplete(200, 'late completion')).resolves.toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
