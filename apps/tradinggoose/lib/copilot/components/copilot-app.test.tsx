/**
 * @vitest-environment jsdom
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotApp } from './copilot-app'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const mocks = vi.hoisted(() => ({
  sessionUser: undefined as { id: string; email: string; name: string } | undefined,
}))
let nextCopilotInstanceId = 0

const mockCopilot = vi.fn(() => {
  const [instanceId] = useState(() => ++nextCopilotInstanceId)
  return <div data-testid='copilot' data-instance-id={instanceId} />
})
const mockProviders = vi.fn(
  ({ children }: { children: React.ReactNode; workspaceId: string; userId?: string }) => (
    <>{children}</>
  )
)
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: mocks.sessionUser },
  }),
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div data-testid='loading-agent' />,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/providers', () => ({
  default: (props: { children: React.ReactNode; workspaceId: string; userId?: string }) =>
    mockProviders(props),
}))

vi.mock('./copilot/copilot', () => ({
  Copilot: () => mockCopilot(),
}))

describe('CopilotApp', () => {
  let container: HTMLDivElement
  let root: Root

  const renderApp = async () => {
    await act(async () => {
      root.render(<CopilotApp workspaceId='ws-1' panelWidth={480} />)
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockCopilot.mockClear()
    mockProviders.mockClear()
    nextCopilotInstanceId = 0
    mocks.sessionUser = { id: 'user-1', email: 'user@example.com', name: 'User' }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('mounts explicit workspace providers', async () => {
    await renderApp()

    expect(mockProviders).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', userId: 'user-1' })
    )
    expect(container.querySelector('[data-testid="copilot"]')).not.toBeNull()
  })

  it('waits for an authenticated user before mounting workspace providers', async () => {
    mocks.sessionUser = undefined

    await renderApp()

    expect(mockProviders).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="loading-agent"]')).not.toBeNull()
  })
})
