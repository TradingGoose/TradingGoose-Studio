/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetWorkspacePermissionsStore,
  useWorkspacePermissions,
} from './use-workspace-permissions'

const mockHandleAuthError = vi.hoisted(() => vi.fn())
const mockUseSession = vi.hoisted(() => vi.fn())
let latestValue: ReturnType<typeof useWorkspacePermissions> | null = null
let workspaceId = 'workspace-401'

vi.mock('@/lib/auth/auth-error-handler', () => ({
  handleAuthError: mockHandleAuthError,
  isAuthErrorStatus: (status?: number | null) => status === 401,
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: mockUseSession,
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/dashboard',
}))

function WorkspacePermissionsProbe() {
  latestValue = useWorkspacePermissions(workspaceId)
  return null
}

describe('useWorkspacePermissions', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    latestValue = null
    workspaceId = 'workspace-401'
    mockHandleAuthError.mockResolvedValue(undefined)
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401, statusText: 'Unauthorized' }))
    )
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
    vi.clearAllMocks()
    resetWorkspacePermissionsStore()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('routes workspace permission 401 responses through auth recovery', async () => {
    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockHandleAuthError).toHaveBeenCalledWith(
      'workspace-permissions',
      '/workspace/workspace-1/dashboard'
    )
    expect(latestValue).toMatchObject({
      loading: true,
      error: null,
      permissions: null,
    })
  })

  it('routes resolved missing sessions through auth recovery without completing permission load', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockHandleAuthError).toHaveBeenCalledWith(
      'workspace-permissions',
      '/workspace/workspace-1/dashboard'
    )
    expect(latestValue).toMatchObject({
      loading: true,
      error: null,
      permissions: null,
    })
  })

  it('does not reuse a cached workspace permission record after the active user changes', async () => {
    workspaceId = 'workspace-1'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          users: [],
          total: 0,
          currentUserPermission: 'admin',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          users: [],
          total: 0,
          currentUserPermission: 'read',
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(latestValue?.permissions?.currentUserPermission).toBe('admin')

    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-2',
        },
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(latestValue?.permissions?.currentUserPermission).toBe('read')
  })
})
