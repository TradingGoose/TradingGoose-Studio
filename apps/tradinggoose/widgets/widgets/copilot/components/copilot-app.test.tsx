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

const mockResolveEntityReviewTarget = vi.fn()
const mockUnregisteredReviewSessionIds = new Set<string>()
const mockCopilot = vi.fn((props: any) => (
  <div data-testid='copilot' data-input-disabled={String(Boolean(props.inputDisabled))}>
    copilot
  </div>
))
let mockPairContext: any = {
  workflowId: null,
  skillId: null,
}

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/providers', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/copilot/review-sessions/entity-session-host', () => ({
  EntitySessionHost: ({ children, descriptor }: { children: React.ReactNode; descriptor: any }) => (
    <div
      data-testid='entity-session-host'
      data-review-session-id={descriptor.reviewSessionId ?? ''}
      data-draft-session-id={descriptor.draftSessionId ?? ''}
      data-entity-id={descriptor.entityId ?? ''}
    >
      {children}
    </div>
  ),
}))

vi.mock('@/lib/yjs/entity-session-registry', () => ({
  useRegisteredEntitySession: (reviewSessionId?: string | null) =>
    reviewSessionId && !mockUnregisteredReviewSessionIds.has(reviewSessionId)
      ? { descriptor: { reviewSessionId } }
      : null,
}))

vi.mock('@/lib/yjs/workflow-session-host', () => ({
  WorkflowSessionProvider: ({
    children,
    workflowId,
  }: {
    children: React.ReactNode
    workflowId: string
  }) => (
    <div data-testid='workflow-session-host' data-workflow-id={workflowId}>
      {children}
    </div>
  ),
}))

vi.mock('@/stores/copilot/store', () => ({
  DEFAULT_COPILOT_CHANNEL_ID: 'default',
  CopilotStoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCopilotStoreApi: () => ({
    getState: () => ({
      currentChat: null,
      chats: [],
      messages: [],
      saveChatMessages: vi.fn(async () => {}),
    }),
    setState: vi.fn(),
  }),
}))

vi.mock('@/stores/dashboard/pair-store', () => ({
  usePairColorContext: () => mockPairContext,
}))

vi.mock('@/widgets/widgets/entity_review/review-target-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/widgets/widgets/entity_review/review-target-utils')>()
  return {
    ...actual,
    resolveEntityReviewTarget: (...args: any[]) => mockResolveEntityReviewTarget(...args),
  }
})

vi.mock('./copilot/copilot', () => ({
  Copilot: (props: any) => mockCopilot(props),
}))

describe('CopilotApp', () => {
  let container: HTMLDivElement
  let root: Root

  const renderApp = async () => {
    await act(async () => {
      root.render(<CopilotApp workspaceId='ws-1' panelWidth={480} pairColor='gray' />)
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPairContext = {
      workflowId: null,
      skillId: null,
    }
    mockResolveEntityReviewTarget.mockReset()
    mockCopilot.mockClear()
    mockUnregisteredReviewSessionIds.clear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders copilot without session hosts when no shared workflow is pinned', async () => {
    await renderApp()

    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="workflow-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).not.toBeNull()
  })

  it('mounts the workflow session host for the current pair-color workflow', async () => {
    mockPairContext = {
      workflowId: 'workflow-current',
      skillId: null,
    }

    await renderApp()

    expect(container.querySelector('[data-testid="workflow-session-host"]')).toHaveAttribute(
      'data-workflow-id',
      'workflow-current'
    )
  })

  it('does not resolve or mount plain non-workflow shared entity ids', async () => {
    mockPairContext = {
      workflowId: null,
      skillId: 'skill-plain',
    }

    await renderApp()

    expect(mockResolveEntityReviewTarget).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).toHaveAttribute(
      'data-input-disabled',
      'false'
    )
  })

  it('mounts canonical pair review metadata as an editable entity target', async () => {
    mockPairContext = {
      workflowId: null,
      skillId: 'skill-current-context',
      reviewSessionId: 'review-1',
      reviewEntityKind: 'skill',
      reviewEntityId: null,
      reviewDraftSessionId: 'draft-1',
    }

    await renderApp()

    expect(mockResolveEntityReviewTarget).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="entity-session-host"]')).toHaveAttribute(
      'data-review-session-id',
      'review-1'
    )
    expect(container.querySelector('[data-testid="entity-session-host"]')).toHaveAttribute(
      'data-draft-session-id',
      'draft-1'
    )
    expect(container.querySelector('[data-testid="copilot"]')).toHaveAttribute(
      'data-input-disabled',
      'false'
    )
  })
})
