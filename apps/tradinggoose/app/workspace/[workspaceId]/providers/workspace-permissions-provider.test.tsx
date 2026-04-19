/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReplace = vi.fn()
const mockUseWorkspacePermissions = vi.fn()
const mockUseUserPermissions = vi.fn()
const mockUpdatePermissions = vi.fn()
const mockRefetchPermissions = vi.fn()

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
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
    window.history.replaceState({}, '', '/workspace/ws-1/dashboard?layoutId=layout-1')

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

  it('redirects missing sessions to login with the current callback target', async () => {
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
      error: 'Authentication required',
    })

    const { WorkspacePermissionsProvider } = await import('./workspace-permissions-provider')

    await act(async () => {
      root?.render(
        <WorkspacePermissionsProvider workspaceId='ws-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(mockReplace).toHaveBeenCalledWith(
      '/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )
    expect(container?.textContent).toBe('')
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
        <WorkspacePermissionsProvider workspaceId='ws-1'>
          <div>workspace</div>
        </WorkspacePermissionsProvider>
      )
    })

    expect(mockReplace).toHaveBeenCalledWith('/workspace')
    expect(container?.textContent).toBe('')
  })
})
