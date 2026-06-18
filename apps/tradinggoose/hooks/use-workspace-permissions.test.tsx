/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspacePermissions } from './use-workspace-permissions'

const mockHandleAuthError = vi.hoisted(() => vi.fn())
let latestValue: ReturnType<typeof useWorkspacePermissions> | null = null

vi.mock('@/lib/auth/auth-error-handler', () => ({
  handleAuthError: mockHandleAuthError,
  isAuthErrorStatus: (status?: number | null) => status === 401,
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/dashboard',
}))

function WorkspacePermissionsProbe() {
  latestValue = useWorkspacePermissions('workspace-401')
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
})
