import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})
const mockGetSession = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()
const mockHeaders = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/providers', () => ({
  default: ({ children, workspaceId }: { children: React.ReactNode; workspaceId?: string }) => (
    <div data-workspace-id={workspaceId}>{children}</div>
  ),
}))

describe('Workspace layout access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockHeaders.mockResolvedValue(new Headers())

    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`redirect:${url}`)
    })
  })

  it('redirects to login with the current callback target when there is no authenticated session', async () => {
    mockGetSession.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(
      new Headers([['x-auth-callback-url', '/workspace/ws-1/dashboard?layoutId=layout-1']])
    )

    const WorkspaceLayout = (await import('./layout')).default

    await expect(
      WorkspaceLayout({
        children: <div>workspace</div>,
        params: Promise.resolve({ workspaceId: 'ws-1' }),
      })
    ).rejects.toThrow(
      'redirect:/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )

    expect(mockRedirect).toHaveBeenCalledWith(
      '/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )
    expect(mockGetSession).toHaveBeenCalledWith(expect.any(Headers), { disableCookieCache: true })
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('redirects to /workspace when the user cannot access the workspace', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: null,
    })

    const WorkspaceLayout = (await import('./layout')).default

    await expect(
      WorkspaceLayout({
        children: <div>workspace</div>,
        params: Promise.resolve({ workspaceId: 'ws-1' }),
      })
    ).rejects.toThrow('redirect:/workspace')

    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(mockRedirect).toHaveBeenCalledWith('/workspace')
  })

  it('renders the workspace route when access is valid', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-1',
      },
    })

    const WorkspaceLayout = (await import('./layout')).default
    const result = await WorkspaceLayout({
      children: <div>workspace</div>,
      params: Promise.resolve({ workspaceId: 'ws-1' }),
    })

    expect(renderToStaticMarkup(result)).toContain('data-workspace-id="ws-1"')
    expect(renderToStaticMarkup(result)).toContain('workspace')
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
