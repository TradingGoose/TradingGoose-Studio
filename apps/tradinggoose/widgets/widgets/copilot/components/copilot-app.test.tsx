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
const mockSetPairColorContext = vi.fn()
const mockSaveChatMessages = vi.fn(async () => {})
const mockCopilot = vi.fn((props: any) => (
  <div
    data-testid='copilot'
    data-input-disabled={String(Boolean(props.inputDisabled))}
  >
    copilot
  </div>
))
let mockLiveWorkflowId: string | null = null
let mockLiveTarget: any = {
  reviewSessionId: null,
  entityKind: null,
  entityId: null,
  draftSessionId: null,
  skillId: null,
}
let mockCopilotStoreState: any = null
const mockCopilotStoreApi = {
  getState: () => mockCopilotStoreState,
  setState: (partial: any) => {
    const nextState =
      typeof partial === 'function' ? partial(mockCopilotStoreState) : partial
    mockCopilotStoreState = {
      ...mockCopilotStoreState,
      ...nextState,
    }
  },
}
const applyMockPairColorContext = (color: string, context: any) => {
  mockSetPairColorContext(color, context)
  mockLiveWorkflowId = context?.workflowId ?? mockLiveWorkflowId
  mockLiveTarget = {
    ...mockLiveTarget,
    skillId: context?.skillId ?? mockLiveTarget.skillId ?? null,
    reviewSessionId: context?.reviewTarget?.reviewSessionId ?? null,
    entityKind: context?.reviewTarget?.reviewEntityKind ?? null,
    entityId: context?.reviewTarget?.reviewEntityId ?? null,
    draftSessionId: context?.reviewTarget?.reviewDraftSessionId ?? null,
  }
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

vi.mock('@/stores/copilot/store', () => ({
  DEFAULT_COPILOT_CHANNEL_ID: 'default',
  CopilotStoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCopilotStoreApi: () => mockCopilotStoreApi,
}))

vi.mock('@/stores/dashboard/pair-store', () => ({
  usePairColorContext: () => ({
    workflowId: mockLiveWorkflowId,
    skillId: mockLiveTarget.skillId,
    reviewTarget: mockLiveTarget.entityKind
      ? {
          reviewSessionId: mockLiveTarget.reviewSessionId,
          reviewEntityKind: mockLiveTarget.entityKind,
          reviewEntityId: mockLiveTarget.entityId,
          reviewDraftSessionId: mockLiveTarget.draftSessionId,
        }
      : undefined,
  }),
  useSetPairColorContext: () => applyMockPairColorContext,
}))

vi.mock('@/widgets/widgets/entity_review/review-target-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/widgets/entity_review/review-target-utils')>()
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
    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: null,
      entityId: null,
      draftSessionId: null,
      skillId: null,
    }
    mockLiveWorkflowId = null
    mockResolveEntityReviewTarget.mockReset()
    mockSetPairColorContext.mockReset()
    mockCopilot.mockClear()
    mockUnregisteredReviewSessionIds.clear()
    mockSaveChatMessages.mockReset()
    mockSaveChatMessages.mockResolvedValue(undefined)
    mockCopilotStoreState = {
      currentChat: {
        reviewSessionId: 'chat-1',
        workspaceId: 'ws-1',
        channelId: 'workflow',
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Copilot chat',
        messages: [],
        messageCount: 0,
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        updatedAt: new Date('2026-04-16T00:00:00.000Z'),
      },
      chats: [
        {
          reviewSessionId: 'chat-1',
          workspaceId: 'ws-1',
          channelId: 'workflow',
          entityKind: 'copilot',
          entityId: null,
          draftSessionId: null,
          title: 'Copilot chat',
          messages: [],
          messageCount: 0,
          createdAt: new Date('2026-04-16T00:00:00.000Z'),
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        },
      ],
      messages: [],
      saveChatMessages: mockSaveChatMessages,
    }
    mockResolveEntityReviewTarget.mockResolvedValue({
      descriptor: {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: null,
        draftSessionId: 'draft-1',
        reviewSessionId: 'review-1',
        yjsSessionId: 'review-1',
      },
      runtime: null,
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders copilot without a target session when no live target is pinned', async () => {
    await renderApp()

    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="workflow-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).not.toBeNull()
  })

  it('mounts the entity session host for non-workflow review targets', async () => {
    mockLiveTarget = {
      reviewSessionId: 'review-1',
      entityKind: 'skill',
      entityId: 'skill-review-target',
      draftSessionId: 'draft-1',
      skillId: 'skill-current-context',
    }

    await renderApp()

    expect(container.querySelector('[data-testid="entity-session-host"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="entity-session-host"]')).toHaveAttribute(
      'data-entity-id',
      'skill-review-target'
    )
  })

  it('resolves and mounts explicit draft review targets', async () => {
    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: 'skill',
      entityId: null,
      draftSessionId: 'draft-1',
    }

    await renderApp()

    expect(container.querySelector('[data-testid="entity-session-host"]')).not.toBeNull()
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

  it('does not resolve or mount plain non-workflow color-store entity targets', async () => {
    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: null,
      entityId: null,
      draftSessionId: null,
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

  it('keeps input disabled until resolved entity sessions are registered', async () => {
    mockUnregisteredReviewSessionIds.add('review-1')
    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: 'skill',
      entityId: null,
      draftSessionId: 'draft-1',
      skillId: null,
    }

    await renderApp()

    expect(container.querySelector('[data-testid="entity-session-host"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).toHaveAttribute(
      'data-input-disabled',
      'true'
    )
  })

  it('rejects failed review target resolution, clears the stale pair target, and unlocks input', async () => {
    mockResolveEntityReviewTarget.mockRejectedValueOnce(new Error('Forbidden'))
    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: 'skill',
      entityId: null,
      draftSessionId: 'draft-stale',
      skillId: 'skill-current-context',
    }

    await renderApp()
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="copilot"]')).toHaveAttribute(
      'data-input-disabled',
      'false'
    )
    expect(mockSetPairColorContext).toHaveBeenCalledWith(
      'gray',
      expect.objectContaining({
        skillId: 'skill-current-context',
        reviewTarget: null,
      })
    )
    expect(mockLiveTarget.entityKind).toBeNull()
    expect(mockCopilotStoreState.messages).toHaveLength(1)
    expect(mockCopilotStoreState.messages[0]).toMatchObject({
      role: 'assistant',
    })
    expect(mockCopilotStoreState.messages[0].content).toContain('was rejected')
    expect(mockSaveChatMessages).toHaveBeenCalledWith('chat-1')
  })

  it('does not mount workflow sessions for current or workflow review targets', async () => {
    mockLiveWorkflowId = 'workflow-current'
    await renderApp()

    expect(container.querySelector('[data-testid="workflow-session-host"]')).toBeNull()

    mockLiveTarget = {
      reviewSessionId: 'review-workflow-1',
      entityKind: 'workflow',
      entityId: 'workflow-target',
      draftSessionId: null,
    }
    await renderApp()

    expect(container.querySelector('[data-testid="workflow-session-host"]')).toBeNull()
  })

  it('does not keep a stale resolved draft entity mounted after the live target changes', async () => {
    mockResolveEntityReviewTarget
      .mockResolvedValueOnce({
        descriptor: {
          workspaceId: 'ws-1',
          entityKind: 'skill',
          entityId: null,
          draftSessionId: 'draft-1',
          reviewSessionId: 'review-1',
          yjsSessionId: 'review-1',
        },
        runtime: null,
      })
      .mockImplementationOnce(() => new Promise(() => {}))

    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: 'skill',
      entityId: null,
      draftSessionId: 'draft-1',
    }
    await renderApp()
    expect(container.querySelector('[data-testid="entity-session-host"]')).not.toBeNull()

    mockLiveTarget = {
      reviewSessionId: null,
      entityKind: 'skill',
      entityId: null,
      draftSessionId: 'draft-2',
    }
    await renderApp()

    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
  })
})
