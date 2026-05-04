/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'

const mockReplace = vi.fn()
const mockUseSession = vi.fn()
const mockPathname = vi.fn()
let fetchMock: ReturnType<typeof vi.fn>

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: (...args: unknown[]) => mockUseSession(...args),
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <svg data-testid='loading-agent' />,
}))

describe('WorkspacePage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockReplace.mockReset()
    mockPathname.mockReturnValue('/zh/workspace')
    window.history.replaceState({}, '', '/zh/workspace')
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
      isPending: false,
      error: null,
    })

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/workspaces') {
        return {
          ok: true,
          json: async () => ({
            workspaces: [{ id: 'ws-1', name: 'Workspace 1' }],
          }),
        } as Response
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('redirects locale-prefixed workspace root visits to the localized workspace dashboard', async () => {
    const WorkspacePage = (await import('./page')).default

    await act(async () => {
      root.render(<WorkspacePage />)
    })

    expect(container.querySelector('[data-testid="loading-agent"]')).not.toBeNull()
    const workspacesCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/workspaces')
    expect(workspacesCall).toBeDefined()
    const requestInit = workspacesCall?.[1] as RequestInit | undefined
    expect(new Headers(requestInit?.headers).get('x-next-intl-locale')).toBe('zh-CN')
    expect(mockReplace).toHaveBeenCalledWith('/zh/workspace/ws-1/dashboard')
  })

  it('continues to fetch workspaces when a localized callbackUrl matches the current pathname', async () => {
    window.history.replaceState({}, '', '/zh/workspace?callbackUrl=/workspace')

    const WorkspacePage = (await import('./page')).default

    await act(async () => {
      root.render(<WorkspacePage />)
    })

    const workspacesCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/workspaces')
    expect(workspacesCall).toBeDefined()
    expect(mockReplace).toHaveBeenCalledWith('/zh/workspace/ws-1/dashboard')
  })

  it('creates a localized default workspace on first run', async () => {
    const copy = getPublicCopy('zh-CN')

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/workspaces' && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            workspaces: [],
          }),
        } as Response
      }

      if (String(input) === '/api/workspaces' && init?.method === 'POST') {
        expect(new Headers(init.headers as HeadersInit).get('x-next-intl-locale')).toBe('zh-CN')
        expect(JSON.parse(String(init.body))).toEqual({
          name: copy.workspace.defaults.newWorkspaceName,
        })

        return {
          ok: true,
          json: async () => ({
            workspace: { id: 'ws-2' },
          }),
        } as Response
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`)
    })

    const WorkspacePage = (await import('./page')).default

    await act(async () => {
      root.render(<WorkspacePage />)
    })

    expect(container.querySelector('[data-testid="loading-agent"]')).not.toBeNull()
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/workspaces' && (init as RequestInit | undefined)?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    expect(mockReplace).toHaveBeenCalledWith('/zh/workspace/ws-2/dashboard')
  })
})
