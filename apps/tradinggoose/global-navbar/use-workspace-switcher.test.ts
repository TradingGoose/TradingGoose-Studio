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
      latestValue = useWorkspaceSwitcher({ enabled: true })
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

  it('redirects the workspace root to the first workspace after mounted bootstrap', async () => {
    const { useWorkspaceSwitcher } = await import('@/global-navbar/use-workspace-switcher')

    function Harness() {
      latestValue = useWorkspaceSwitcher({
        enabled: true,
        section: 'dashboard',
      })
      return null
    }

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/workspaces')
    expect(mockReplace).toHaveBeenCalledWith('/workspace/ws-1/dashboard')
  })
})
