import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANONICAL_CALLBACK_PATH_HEADER } from '@/i18n/utils'

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})
const mockGetSession = vi.fn()
const mockHeaders = vi.fn()
const mockGetUserWorkspaces = vi.fn()
const mockReadWorkflowAccessContext = vi.fn()

function mockLocalizedRedirect({
  href,
  locale,
}: {
  href: string | { pathname: string; query?: Record<string, string> }
  locale?: string
}) {
  const canonicalPath =
    typeof href === 'string'
      ? href
      : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query).toString()}` : ''}`
  const localizedPath =
    locale && canonicalPath.startsWith('/') ? `/${locale}${canonicalPath}` : canonicalPath
  return mockRedirect(localizedPath)
}

vi.mock('@/i18n/navigation', () => ({
  redirect: mockLocalizedRedirect,
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/workspaces/service', () => ({
  getUserWorkspaces: (...args: unknown[]) => mockGetUserWorkspaces(...args),
}))

vi.mock('@/lib/workflows/utils', () => ({
  readWorkflowAccessContext: (...args: unknown[]) => mockReadWorkflowAccessContext(...args),
}))

async function renderWorkspacePage(
  locale = 'en',
  searchParams: { callbackUrl?: string; redirect_workflow?: string } = {}
) {
  const WorkspacePage = (await import('./page')).default
  return WorkspacePage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(searchParams),
  })
}

describe('Workspace root page access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockHeaders.mockResolvedValue(new Headers())

    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`redirect:${url}`)
    })
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
        name: 'Ada Lovelace',
      },
    })
    mockGetUserWorkspaces.mockResolvedValue([{ id: 'workspace-1' }])
    mockReadWorkflowAccessContext.mockResolvedValue(null)
  })

  it('redirects signed-out users to login with the current callback target', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([[CANONICAL_CALLBACK_PATH_HEADER, '/workspace?redirect_workflow=workflow-1']])
    )
    mockGetSession.mockResolvedValue(null)

    await expect(renderWorkspacePage('zh')).rejects.toThrow(
      'redirect:/zh/login?callbackUrl=%2Fworkspace%3Fredirect_workflow%3Dworkflow-1'
    )

    expect(mockRedirect).toHaveBeenCalledWith(
      '/zh/login?callbackUrl=%2Fworkspace%3Fredirect_workflow%3Dworkflow-1'
    )
    expect(mockGetSession).toHaveBeenCalledWith(expect.any(Headers))
  })

  it('routes invalid session cookies through reauth cleanup', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        [CANONICAL_CALLBACK_PATH_HEADER, '/workspace?redirect_workflow=workflow-1'],
        ['cookie', 'better-auth.session_token=stale'],
      ])
    )
    mockGetSession.mockResolvedValue(null)

    await expect(renderWorkspacePage('zh')).rejects.toThrow(
      'redirect:/zh/login?reauth=1&callbackUrl=%2Fworkspace%3Fredirect_workflow%3Dworkflow-1'
    )

    expect(mockRedirect).toHaveBeenCalledWith(
      '/zh/login?reauth=1&callbackUrl=%2Fworkspace%3Fredirect_workflow%3Dworkflow-1'
    )
    expect(mockGetSession).toHaveBeenCalledWith(expect.any(Headers))
  })

  it('redirects authenticated users to the requested workflow workspace', async () => {
    mockReadWorkflowAccessContext.mockResolvedValue({
      workflow: {
        workspaceId: 'workspace-from-workflow',
      },
      isOwner: false,
      isWorkspaceOwner: false,
      workspacePermission: 'read',
    })
    await expect(renderWorkspacePage('en', { redirect_workflow: 'workflow-1' })).rejects.toThrow(
      'redirect:/en/workspace/workspace-from-workflow/dashboard'
    )

    expect(mockReadWorkflowAccessContext).toHaveBeenCalledWith('workflow-1', 'user-1')
    expect(mockGetUserWorkspaces).not.toHaveBeenCalled()
  })

  it('redirects authenticated users to same-origin absolute callback URLs', async () => {
    mockHeaders.mockResolvedValue(new Headers([['host', 'preview.local:3000']]))

    await expect(
      renderWorkspacePage('en', {
        callbackUrl: 'http://preview.local:3000/workspace/workspace-2/dashboard?layoutId=layout-1',
      })
    ).rejects.toThrow('redirect:/en/workspace/workspace-2/dashboard?layoutId=layout-1')

    expect(mockGetUserWorkspaces).not.toHaveBeenCalled()
  })

  it('redirects authenticated users to their first workspace dashboard', async () => {
    await expect(renderWorkspacePage('es')).rejects.toThrow(
      'redirect:/es/workspace/workspace-1/dashboard'
    )

    expect(mockGetUserWorkspaces).toHaveBeenCalledWith({
      userId: 'user-1',
    })
  })
})
