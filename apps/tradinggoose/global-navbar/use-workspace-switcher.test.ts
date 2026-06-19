/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockSwitchToWorkspace = vi.fn()
let fetchMock: ReturnType<typeof vi.fn>
let originalFetch: typeof globalThis.fetch
let container: HTMLDivElement | null = null
let root: Root | null = null
let latestValue: any = null

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function workspaceResponse(id: string, name: string) {
  return {
    ok: true,
    json: async () => ({
      workspaces: [
        {
          id,
          name,
          ownerId: 'user-1',
          permissions: 'admin',
          role: 'owner',
        },
      ],
    }),
  }
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (
    selector: (state: { switchToWorkspace: typeof mockSwitchToWorkspace }) => unknown
  ) =>
    selector({
      switchToWorkspace: mockSwitchToWorkspace,
    }),
}))

describe('useWorkspaceSwitcher', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockReplace.mockReset()
    mockSwitchToWorkspace = vi.fn()
    latestValue = null

    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Workspace One',
            ownerId: 'user-1',
            permissions: 'admin',
            role: 'owner',
          },
        ],
      }),
    }))

    originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof globalThis.fetch

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
    globalThis.fetch = originalFetch
  })

  it('keeps the standard workspace switcher behavior on admin routes', async () => {
    const { useWorkspaceSwitcher } = await import('@/global-navbar/use-workspace-switcher')

    function Harness() {
      latestValue = useWorkspaceSwitcher({ enabled: true, userId: 'user-1' })
      return null
    }

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(latestValue).not.toBeNull()
    expect(latestValue.canManageWorkspaces).toBe(true)
    expect(latestValue.activeWorkspace?.id).toBe('ws-1')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/workspaces')
    expect(mockReplace).not.toHaveBeenCalled()

    await act(async () => {
      latestValue.setWorkspaceMenuOpen(true)
      latestValue.handleStartEditing(latestValue.activeWorkspace)
      latestValue.setEditingWorkspaceName('Renamed workspace')
      latestValue.handleOpenInviteDialog(latestValue.activeWorkspace)
      latestValue.setWorkspaceToDelete(latestValue.activeWorkspace)
      latestValue.handleDeleteDialogChange(true)
    })

    expect(latestValue.workspaceMenuOpen).toBe(true)
    expect(latestValue.editingWorkspaceId).toBe('ws-1')
    expect(latestValue.inviteDialogOpen).toBe(true)
    expect(latestValue.deleteDialogOpen).toBe(true)
  })

  it('does not redirect during the workspace bootstrap fetch (server owns the root redirect)', async () => {
    const { useWorkspaceSwitcher } = await import('@/global-navbar/use-workspace-switcher')

    function Harness() {
      latestValue = useWorkspaceSwitcher({
        enabled: true,
        userId: 'user-1',
        section: 'dashboard',
      })
      return null
    }

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/workspaces')
    expect(latestValue.activeWorkspace?.id).toBe('ws-1')
    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('waits for client auth readiness before the initial workspace load', async () => {
    const { useWorkspaceSwitcher } = await import('@/global-navbar/use-workspace-switcher')
    let authReady = false

    function Harness() {
      latestValue = useWorkspaceSwitcher({
        enabled: true,
        userId: 'user-1',
        authReady,
      })
      return null
    }

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(latestValue.isWorkspacesLoading).toBe(true)

    authReady = true

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces')
    expect(latestValue.activeWorkspace?.id).toBe('ws-1')
  })

  it('clears workspace data and disables workspace actions when client auth is not ready', async () => {
    const { useWorkspaceSwitcher } = await import('@/global-navbar/use-workspace-switcher')
    let authReady = true

    function Harness() {
      latestValue = useWorkspaceSwitcher({
        enabled: true,
        userId: 'user-1',
        authReady,
      })
      return null
    }

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(latestValue.activeWorkspace?.id).toBe('ws-1')
    expect(latestValue.canManageWorkspaces).toBe(true)

    await act(async () => {
      latestValue.setWorkspaceMenuOpen(true)
      latestValue.handleStartEditing(latestValue.activeWorkspace)
      latestValue.handleOpenInviteDialog(latestValue.activeWorkspace)
      latestValue.setWorkspaceToDelete(latestValue.activeWorkspace)
      latestValue.handleDeleteDialogChange(true)
      await flush()
    })

    authReady = false

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(latestValue.canManageWorkspaces).toBe(false)
    expect(latestValue.activeWorkspace).toBeNull()
    expect(latestValue.workspaces).toEqual([])
    expect(latestValue.isWorkspacesLoading).toBe(true)
    expect(latestValue.workspaceMenuOpen).toBe(false)
    expect(latestValue.editingWorkspaceId).toBeNull()
    expect(latestValue.inviteDialogOpen).toBe(false)
    expect(latestValue.inviteWorkspace).toBeNull()
    expect(latestValue.deleteDialogOpen).toBe(false)
    expect(latestValue.workspaceToDelete).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores stale workspace responses from a previous authenticated user key', async () => {
    const { useWorkspaceSwitcher } = await import('@/global-navbar/use-workspace-switcher')
    const firstResponse = deferred<ReturnType<typeof workspaceResponse>>()
    const secondResponse = deferred<ReturnType<typeof workspaceResponse>>()
    fetchMock
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)
    let userId = 'user-1'

    function Harness() {
      latestValue = useWorkspaceSwitcher({
        enabled: true,
        userId,
        authReady: true,
      })
      return null
    }

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    userId = 'user-2'

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    await act(async () => {
      secondResponse.resolve(workspaceResponse('ws-user-2', 'User Two Workspace'))
      await flush()
    })

    expect(latestValue.activeWorkspace?.id).toBe('ws-user-2')
    expect(latestValue.canManageWorkspaces).toBe(true)
    expect(latestValue.isWorkspacesLoading).toBe(false)

    await act(async () => {
      firstResponse.resolve(workspaceResponse('ws-user-1', 'User One Workspace'))
      await flush()
    })

    expect(latestValue.activeWorkspace?.id).toBe('ws-user-2')
    expect(latestValue.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
      'ws-user-2',
    ])
    expect(latestValue.canManageWorkspaces).toBe(true)
    expect(latestValue.isWorkspacesLoading).toBe(false)
  })
})
