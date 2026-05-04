/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'zh-CN'),
}))

const mockPush = vi.fn()
let mockPathname = '/workspace/ws-1/dashboard'
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

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (
    selector: (state: { switchToWorkspace: typeof mockSwitchToWorkspace }) => unknown
  ) =>
    selector({
      switchToWorkspace: mockSwitchToWorkspace,
    }),
}))

describe('shouldResetWorkflowRegistryOnWorkspaceSwitch', () => {
  it('returns false outside workspace-scoped routes', async () => {
    const { shouldResetWorkflowRegistryOnWorkspaceSwitch } = await import(
      '@/global-navbar/use-workspace-switcher'
    )
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/admin')).toBe(false)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/zh/admin')).toBe(false)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/admin/integrations')).toBe(false)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/login')).toBe(false)
  })

  it('returns true inside workspace-scoped routes', async () => {
    const { shouldResetWorkflowRegistryOnWorkspaceSwitch } = await import(
      '@/global-navbar/use-workspace-switcher'
    )
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/workspace/ws-1/dashboard')).toBe(true)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/zh/workspace/ws-1/dashboard')).toBe(
      true
    )
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/workspace/ws-1/w/wf-1')).toBe(true)
  })
})

describe('useWorkspaceSwitcher', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockSwitchToWorkspace = vi.fn()
    mockPathname = '/zh/workspace/ws-1/dashboard'
    useLocaleMock.mockReturnValue('zh-CN')
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

    mockPathname = '/admin'

    await act(async () => {
      root?.render(React.createElement(Harness))
      await flush()
    })

    expect(latestValue).not.toBeNull()
    expect(latestValue.canManageWorkspaces).toBe(true)
    expect(latestValue.activeWorkspace?.id).toBe('ws-1')

    const workspacesCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/workspaces')
    expect(workspacesCall).toBeDefined()
    const requestInit = workspacesCall?.[1] as RequestInit | undefined
    expect(new Headers(requestInit?.headers).get('x-next-intl-locale')).toBe('zh-CN')

    await act(async () => {
      await latestValue.handleSwitchWorkspace({
        id: 'ws-2',
        name: 'Workspace Two',
        ownerId: 'user-1',
        permissions: 'admin',
        role: 'owner',
      })
    })

    expect(mockSwitchToWorkspace).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/zh/workspace/ws-2/dashboard')

    await act(async () => {
      latestValue.setWorkspaceMenuOpen(true)
      latestValue.handleStartEditing(latestValue.activeWorkspace)
      latestValue.setEditingWorkspaceName('Renamed workspace')
      latestValue.handleOpenInviteDialog(latestValue.activeWorkspace)
      latestValue.setWorkspaceToDelete(latestValue.activeWorkspace)
      latestValue.handleDeleteDialogChange(true)
    })

    expect(latestValue.workspaceMenuOpen).toBe(true)
    expect(latestValue.editingWorkspaceId).toBe('ws-2')
    expect(latestValue.inviteDialogOpen).toBe(true)
    expect(latestValue.deleteDialogOpen).toBe(true)
  })
})
