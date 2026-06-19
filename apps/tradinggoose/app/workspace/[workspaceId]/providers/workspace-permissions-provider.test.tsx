/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReplace = vi.fn()
const mockUseWorkspacePermissions = vi.fn()
const mockUseUserPermissions = vi.fn()
const mockUseSession = vi.fn()
const mockUpdatePermissions = vi.fn()
const mockRefetchPermissions = vi.fn()

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/hooks/use-workspace-permissions', () => ({
  useWorkspacePermissions: (...args: unknown[]) => mockUseWorkspacePermissions(...args),
}))

vi.mock('@/hooks/use-user-permissions', () => ({
  useUserPermissions: (...args: unknown[]) => mockUseUserPermissions(...args),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('WorkspacePermissionsProvider', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
      isPending: false,
    })

    mockUseWorkspacePermissions.mockReturnValue({
      permissions: null,
      loading: false,
      error: null,
      updatePermissions: mockUpdatePermissions,
      refetch: mockRefetchPermissions,
    })

    mockUseUserPermissions.mockReturnValue({
      canRead: true,
      canEdit: true,
      canAdmin: false,
      userPermissions: 'write',
      isLoading: false,
      error: null,
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    root = null
    container?.remove()
    container = null
  })

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('redirects authenticated users without access back to the workspace index', async () => {
    mockUseWorkspacePermissions.mockReturnValue({
      permissions: null,
      loading: false,
      error: 'Workspace not found or access denied',
      updatePermissions: mockUpdatePermissions,
      refetch: mockRefetchPermissions,
    })

    mockUseUserPermissions.mockReturnValue({
      canRead: false,
      canEdit: false,
      canAdmin: false,
      userPermissions: 'read',
      isLoading: false,
      error: 'Workspace not found or access denied',
    })

    const { WorkspacePermissionsProvider } = await import('./workspace-permissions-provider')

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1' userId='user-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(mockReplace).toHaveBeenCalledWith('/workspace')
    expect(container?.textContent).toBe('')
  })

  it('blocks rendering during auth recovery without replacing the auth redirect', async () => {
    mockUseWorkspacePermissions.mockReturnValue({
      permissions: null,
      loading: false,
      error: 'SESSION_EXPIRED',
      updatePermissions: mockUpdatePermissions,
      refetch: mockRefetchPermissions,
    })

    mockUseUserPermissions.mockReturnValue({
      canRead: false,
      canEdit: false,
      canAdmin: false,
      userPermissions: 'read',
      isLoading: false,
      error: 'SESSION_EXPIRED',
    })

    const { WorkspacePermissionsProvider } = await import('./workspace-permissions-provider')

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1' userId='user-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(mockReplace).not.toHaveBeenCalled()
    expect(container?.textContent).toBe('')
  })

  it('waits for matching client auth readiness before loading workspace permissions', async () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
    })

    const { WorkspacePermissionsProvider } = await import('./workspace-permissions-provider')

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1' userId='user-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(mockUseWorkspacePermissions).toHaveBeenCalledWith('ws-1', 'user-1', {
      authReady: false,
    })

    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
      isPending: true,
    })

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1' userId='user-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(mockUseWorkspacePermissions).toHaveBeenLastCalledWith('ws-1', 'user-1', {
      authReady: true,
    })
  })

  it('unblocks children when the authenticated user changes on the same workspace', async () => {
    mockUseWorkspacePermissions.mockReturnValue({
      permissions: null,
      loading: false,
      error: 'Workspace not found or access denied',
      updatePermissions: mockUpdatePermissions,
      refetch: mockRefetchPermissions,
    })
    mockUseUserPermissions.mockReturnValue({
      canRead: false,
      canEdit: false,
      canAdmin: false,
      userPermissions: 'read',
      isLoading: false,
      error: 'Workspace not found or access denied',
    })

    const { WorkspacePermissionsProvider } = await import('./workspace-permissions-provider')

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1' userId='user-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(container?.textContent).toBe('')

    mockUseWorkspacePermissions.mockReturnValue({
      permissions: {
        users: [],
        total: 0,
        currentUserPermission: 'admin',
      },
      loading: false,
      error: null,
      updatePermissions: mockUpdatePermissions,
      refetch: mockRefetchPermissions,
    })
    mockUseUserPermissions.mockReturnValue({
      canRead: true,
      canEdit: true,
      canAdmin: true,
      userPermissions: 'admin',
      isLoading: false,
      error: null,
    })

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1' userId='user-2'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(container?.textContent).toBe('workspace')
  })
})
