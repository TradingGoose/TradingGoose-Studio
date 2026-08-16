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
  <div
    data-testid='copilot'
    data-input-disabled={String(Boolean(props.inputDisabled))}
    data-review-session-id={props.reviewTarget?.reviewSessionId ?? ''}
  >
    copilot
  </div>
))
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

vi.mock('@/stores/copilot/store', () => ({
  DEFAULT_COPILOT_CHANNEL_ID: 'default',
  CopilotStoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./copilot/copilot', () => ({
  Copilot: (props: any) => mockCopilot(props),
}))

describe('CopilotApp', () => {
  let container: HTMLDivElement
  let root: Root

  const renderApp = async (effectiveParams?: Record<string, unknown> | null) => {
    await act(async () => {
      root.render(
        <CopilotApp workspaceId='ws-1' panelWidth={480} effectiveParams={effectiveParams} />
      )
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockCopilot.mockClear()
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
    expect(container.querySelector('[data-testid="copilot"]')).not.toBeNull()
  })

  it('mounts the workflow session host for the effective workflow', async () => {
    await renderApp({
      workflowId: 'workflow-current',
      skillId: null,
    })

    expect(container.querySelector('[data-testid="workflow-session-host"]')).toHaveAttribute(
      'data-workflow-id',
      'workflow-current'
    )
  })

  it('does not derive editable review sessions from effective entity references', async () => {
    await renderApp({
      workflowId: null,
      skillId: 'skill-current',
    })

    expect(container.querySelector('[data-testid="copilot"]')).toHaveAttribute(
      'data-review-session-id',
      ''
    )
  })
})
