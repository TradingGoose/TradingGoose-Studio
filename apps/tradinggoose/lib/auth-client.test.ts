/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const analytics = vi.hoisted(() => ({
  __loaded: true,
  init: vi.fn(),
  get_property: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('posthog-js', () => ({ default: analytics }))
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SSO_ENABLED: false },
  getEnv: () => undefined,
}))

const user = {
  id: 'owner',
  name: 'Original name',
  email: 'owner@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function sessionResponse(profile: typeof user | null) {
  return Response.json(
    profile && {
      user: profile,
      session: {
        id: 'session',
        userId: profile.id,
        token: 'token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    }
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.resetModules()
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

describe('native auth client session', () => {
  it('uses the browser origin for same-origin auth requests', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(null))
    vi.stubGlobal('fetch', fetch)
    const { client } = await import('./auth-client')
    await client.getSession()
    expect(String(fetch.mock.calls[0][0])).toBe(`${window.location.origin}/api/auth/get-session`)
  })

  it('shares native profile refreshes and retains identity after a failed refresh', async () => {
    let storedUser = { ...user }
    let failRefresh = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input instanceof Request ? input.url : input)).pathname
        if (path === '/api/auth/update-user') {
          storedUser = { ...storedUser, ...JSON.parse(String(init?.body)) }
          return Response.json({ status: true })
        }
        if (path !== '/api/auth/get-session') throw new Error(`Unexpected request: ${path}`)
        if (failRefresh) return Response.json({ message: 'Unavailable' }, { status: 503 })
        return sessionResponse(storedUser)
      })
    )
    const { client, useSession } = await import('./auth-client')
    let session!: ReturnType<typeof useSession>
    function Consumer() {
      session = useSession()
      return createElement('span', null, session.data?.user.name)
    }
    await act(async () =>
      root.render(createElement('div', null, createElement(Consumer), createElement(Consumer)))
    )
    await vi.waitFor(() => expect(container.textContent).toBe('Original nameOriginal name'))
    await act(async () => {
      await client.updateUser({ name: 'Chosen name' })
    })
    await vi.waitFor(() => expect(container.textContent).toBe('Chosen nameChosen name'))
    failRefresh = true
    await act(async () => {
      await session.refetch()
    })
    expect(session.error?.status).toBe(503)
    expect(session.isPending).toBe(false)
    expect(container.textContent).toBe('Chosen nameChosen name')
  })
})

describe('PostHog session identity', () => {
  let identity: { state: 'anonymous' | 'identified'; distinctId: string; sessionId: string }

  beforeEach(() => {
    identity = { state: 'anonymous', distinctId: 'anonymous-id', sessionId: 'anonymous-session' }
    analytics.get_property.mockReset().mockImplementation((property) => {
      expect(property).toBe('$user_state')
      return identity.state
    })
    analytics.identify.mockReset().mockImplementation((id: string) => {
      identity.state = 'identified'
      identity.distinctId = id
    })
    analytics.reset.mockReset().mockImplementation(() => {
      identity = { state: 'anonymous', distinctId: 'new-anonymous-id', sessionId: 'new-session' }
    })
  })

  async function mount() {
    const { useSession } = await import('./auth-client')
    const { PostHogProvider } = await import('./posthog/provider')
    let session!: ReturnType<typeof useSession>
    function Consumer() {
      session = useSession()
      return null
    }
    await act(async () =>
      root.render(createElement(PostHogProvider, null, createElement(Consumer)))
    )
    return () => session
  }

  it('preserves an anonymous visitor’s distinct ID and session across session refreshes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sessionResponse(null))
    )
    const session = await mount()
    await vi.waitFor(() => expect(session().isPending).toBe(false))
    await act(async () => session().refetch())
    expect(analytics.identify).not.toHaveBeenCalled()
    expect(analytics.reset).not.toHaveBeenCalled()
    expect(identity).toEqual({
      state: 'anonymous',
      distinctId: 'anonymous-id',
      sessionId: 'anonymous-session',
    })
  })

  it('clears a persisted identified user only after the initial anonymous session resolves', async () => {
    identity.state = 'identified'
    identity.distinctId = 'previous-user'
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          })
        )
        .mockImplementation(async () => sessionResponse(null))
    )
    const session = await mount()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(session().isPending).toBe(true)
    expect(analytics.reset).not.toHaveBeenCalled()
    expect(analytics.identify).not.toHaveBeenCalled()
    await act(async () => finish(sessionResponse(null)))
    await vi.waitFor(() => expect(analytics.reset).toHaveBeenCalledOnce())
    expect(identity.state).toBe('anonymous')
    await act(async () => session().refetch())
    expect(analytics.reset).toHaveBeenCalledOnce()
  })

  it('identifies a signed-in user and resets once on logout', async () => {
    let profile: typeof user | null = user
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sessionResponse(profile))
    )
    const session = await mount()
    await vi.waitFor(() =>
      expect(analytics.identify).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ email: user.email, name: user.name })
      )
    )
    expect(analytics.reset).not.toHaveBeenCalled()
    profile = null
    await act(async () => session().refetch())
    await vi.waitFor(() => expect(analytics.reset).toHaveBeenCalledOnce())
    expect(identity.state).toBe('anonymous')
    await act(async () => session().refetch())
    expect(analytics.reset).toHaveBeenCalledOnce()
  })
})
