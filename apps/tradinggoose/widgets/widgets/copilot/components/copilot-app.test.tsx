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

const mockCopilot = vi.fn((props: any) => (
  <div data-testid='copilot' data-input-disabled={String(Boolean(props.inputDisabled))}>
    copilot
  </div>
))
const mockUseResolvedReviewTarget = vi.fn()
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

vi.mock('@/lib/copilot/review-sessions/entity-session-host', () => ({
  EntitySessionHost: ({ children, descriptor }: any) => (
    <div
      data-testid='entity-session-host'
      data-review-session-id={descriptor.reviewSessionId ?? ''}
    >
      {children}
    </div>
  ),
}))

vi.mock('@/widgets/widgets/entity_review/use-resolved-review-target', () => ({
  useResolvedReviewTarget: (...args: unknown[]) => mockUseResolvedReviewTarget(...args),
}))

vi.mock('@/stores/copilot/store', () => ({
  DEFAULT_COPILOT_CHANNEL_ID: 'default',
  CopilotStoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/stores/dashboard/pair-store', () => ({
  usePairColorContext: () => mockPairContext,
}))

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
    mockCopilot.mockClear()
    mockUseResolvedReviewTarget.mockReset()
    mockUseResolvedReviewTarget.mockReturnValue({ descriptor: null })
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

    expect(container.querySelector('[data-testid="workflow-session-host"]')).toBeNull()
    expect(container.querySelector('[data-testid="entity-session-host"]')).toBeNull()
    expect(mockUseResolvedReviewTarget).not.toHaveBeenCalled()
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
    expect(mockUseResolvedReviewTarget).not.toHaveBeenCalled()
  })

  it('mounts the entity session host for the current pair-color entity', async () => {
    mockPairContext = {
      workflowId: null,
      skillId: 'skill-current',
    }
    mockUseResolvedReviewTarget.mockReturnValue({
      descriptor: {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: 'skill-current',
        draftSessionId: null,
        reviewSessionId: 'review-skill-current',
        yjsSessionId: 'review-skill-current',
      },
    })

    await renderApp()

    expect(mockUseResolvedReviewTarget).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-current',
    })
    expect(container.querySelector('[data-testid="entity-session-host"]')).toHaveAttribute(
      'data-review-session-id',
      'review-skill-current'
    )
  })
})
