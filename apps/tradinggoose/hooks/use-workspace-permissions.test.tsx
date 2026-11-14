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
let latestValue: ReturnType<typeof useWorkspacePermissions> | null = null
let workspaceId = 'workspace-401'
let userId = 'user-1'
let requireFresh = false

vi.mock('@/lib/auth/auth-error-handler', () => ({
  handleAuthError: mockHandleAuthError,
  isAuthErrorStatus: (status?: number | null) => status === 401,
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/dashboard',
}))

function WorkspacePermissionsProbe() {
  latestValue = useWorkspacePermissions(workspaceId, userId, { requireFresh })
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
    userId = 'user-1'
    requireFresh = false
    mockHandleAuthError.mockResolvedValue(undefined)
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
      loading: false,
      error: 'SESSION_EXPIRED',
      permissions: null,
    })
  })

  it('does not refetch a session recovery record after remounting the same user workspace key', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(latestValue).toMatchObject({
      loading: false,
      error: 'SESSION_EXPIRED',
      permissions: null,
    })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockHandleAuthError).toHaveBeenCalledTimes(1)
    expect(latestValue).toMatchObject({
      loading: false,
      error: 'SESSION_EXPIRED',
      permissions: null,
    })
  })

  it('uses the server-authenticated user id instead of client session state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        users: [],
        total: 0,
        currentUserPermission: 'admin',
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-401/permissions')
    expect(mockHandleAuthError).not.toHaveBeenCalled()
    expect(latestValue).toMatchObject({
      loading: false,
      error: null,
      permissions: {
        currentUserPermission: 'admin',
      },
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

    userId = 'user-2'

    await act(async () => {
      root.render(<WorkspacePermissionsProbe />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(latestValue?.permissions?.currentUserPermission).toBe('read')
  })
  it('blocks a fresh mount over a cached positive until its own real refresh settles', async () => {
    const admin = { users: [], total: 0, currentUserPermission: 'admin' }
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(admin))
    await act(async () => root.render(<WorkspacePermissionsProbe />))
    expect(latestValue?.permissions).toEqual(admin)
    act(() => root.unmount())
    root = createRoot(container)
    let finish!: (value: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve
      })
    )
    requireFresh = true
    await act(async () => root.render(<WorkspacePermissionsProbe />))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(latestValue?.loading).toBe(true)
    await act(async () => finish(new Response(null, { status: 403, statusText: 'Forbidden' })))
    expect(latestValue?.loading).toBe(false)
    expect(latestValue?.error).toContain('Forbidden')
    expect(mockHandleAuthError).not.toHaveBeenCalled()
  })

  it('serializes simultaneous forced reads after an older in-flight positive', async () => {
    const finishes: Array<(value: Response) => void> = []
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishes.push(resolve)
        })
    )
    await act(async () => root.render(<WorkspacePermissionsProbe />))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = latestValue!.refetch()
      second = latestValue!.refetch()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () =>
      finishes[0](Response.json({ users: [], total: 0, currentUserPermission: 'admin' }))
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () => finishes[1](new Response(null, { status: 403, statusText: 'Forbidden' })))
    expect(fetch).toHaveBeenCalledTimes(3)
    await act(async () => {
      finishes[2](new Response(null, { status: 404, statusText: 'Not Found' }))
      await Promise.all([first, second])
    })
    expect(latestValue?.loading).toBe(false)
    expect(latestValue?.error).toContain('access denied')
  })

  it('releases the existing in-flight slot after a synchronous transport failure', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => {
      throw new Error('Synchronous source failure')
    })
    await act(async () => root.render(<WorkspacePermissionsProbe />))
    expect(latestValue?.error).toBe('Synchronous source failure')
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ users: [], total: 0, currentUserPermission: 'admin' })
    )
    await act(async () => latestValue!.refetch())
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(latestValue?.permissions?.currentUserPermission).toBe('admin')
    expect(latestValue?.error).toBeNull()
  })
})
