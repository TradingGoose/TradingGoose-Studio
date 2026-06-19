/** @vitest-environment jsdom */

import { act } from 'react'
import type React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceInviteModal } from './workspace-dialogs'

const mockUseWorkspacePermissionsContext = vi.hoisted(() => vi.fn())
const mockUseUserPermissionsContext = vi.hoisted(() => vi.fn())
const mockUpdatePermissions = vi.hoisted(() => vi.fn())
const mockRefetchPermissions = vi.hoisted(() => vi.fn())

const userPermissions = {
  canRead: true,
  canEdit: true,
  canAdmin: true,
  userPermissions: 'admin',
  isLoading: false,
  error: null,
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: React.ReactNode }) => children,
  useWorkspacePermissionsContext: () => mockUseWorkspacePermissionsContext(),
  useUserPermissionsContext: () => mockUseUserPermissionsContext(),
}))

describe('WorkspaceInviteModal', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockRefetchPermissions.mockResolvedValue(undefined)
    mockUseUserPermissionsContext.mockReturnValue(userPermissions)
    mockUseWorkspacePermissionsContext.mockReturnValue({
      workspacePermissions: {
        users: [],
        total: 0,
        currentUserPermission: 'admin',
      },
      permissionsLoading: false,
      permissionsError: null,
      updatePermissions: mockUpdatePermissions,
      refetchPermissions: mockRefetchPermissions,
      userPermissions,
      setOfflineMode: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ invitations: [] })))

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('renders the restored current-user row when the permission users list is empty', async () => {
    await act(async () => {
      root.render(
        <WorkspaceInviteModal
          open
          onOpenChange={vi.fn()}
          currentUserId='user-1'
          currentUserEmail='owner@example.com'
          workspaceName='Workspace One'
          workspaceId='ws-1'
          workspaceOwnerId='user-1'
        />
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.body.textContent).toContain('owner@example.com')
  })
})
