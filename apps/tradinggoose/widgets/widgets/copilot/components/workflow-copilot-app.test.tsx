/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotApp } from './copilot-app'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let mockCurrentChat: any = null

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
      },
    },
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/providers', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/copilot/review-sessions/entity-session-host', () => ({
  EntitySessionHost: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='entity-session-host'>{children}</div>
  ),
}))

vi.mock('@/lib/yjs/workflow-session-host', () => ({
  WorkflowSessionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='workflow-session-provider'>{children}</div>
  ),
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  WorkflowRouteProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/stores/copilot/store', () => ({
  CopilotStoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCopilotStore: (selector?: (state: { currentChat: any }) => unknown) => {
    const state = { currentChat: mockCurrentChat }
    return selector ? selector(state) : state
  },
}))

vi.mock('./copilot/copilot', () => ({
  Copilot: () => <div data-testid='copilot'>copilot</div>,
}))

describe('CopilotApp', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockCurrentChat = null
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('uses the workflow session host when the active chat is generic', async () => {
    await act(async () => {
      root.render(
        <CopilotApp
          workspaceId='ws-1'
          workflowId='wf-1'
          panelWidth={480}
          pairColor='gray'
        />
      )
    })

    expect(container.querySelector('[data-testid="workflow-session-provider"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).not.toBeNull()
  })

  it('uses the entity session host when the active chat is an entity review session', async () => {
    mockCurrentChat = {
      reviewSessionId: 'review-1',
      workspaceId: 'ws-1',
      channelId: null,
      entityKind: 'skill',
      entityId: null,
      draftSessionId: 'draft-1',
      title: 'Skill review',
      messages: [],
      messageCount: 0,
      conversationId: null,
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    }

    await act(async () => {
      root.render(
        <CopilotApp
          workspaceId='ws-1'
          workflowId='wf-1'
          panelWidth={480}
          pairColor='gray'
        />
      )
    })

    expect(container.querySelector('[data-testid="entity-session-host"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workflow-session-provider"]')).toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).not.toBeNull()
  })
})
