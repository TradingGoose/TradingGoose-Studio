/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_SSO_ENABLED: false } }))

const user = {
  id: 'owner',
  name: 'Original name',
  email: 'owner@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

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
        return Response.json({
          user: storedUser,
          session: {
            id: 'session',
            userId: user.id,
            token: 'token',
            expiresAt: '2099-01-01T00:00:00.000Z',
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
        })
      })
    )
    const { client, useSession } = await import('./auth-client')
    let session!: ReturnType<typeof useSession>
    function Consumer() {
      session = useSession()
      return createElement('span', null, session.data?.user.name)
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    const refresh = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
    try {
      await act(async () =>
        root.render(createElement('div', null, createElement(Consumer), createElement(Consumer)))
      )
      await refresh()
      expect(container.textContent).toBe('Original nameOriginal name')
      await act(async () => {
        await client.updateUser({ name: 'Chosen name' })
      })
      await refresh()
      expect(container.textContent).toBe('Chosen nameChosen name')
      failRefresh = true
      await act(async () => {
        await session.refetch()
      })
      expect(session.error?.status).toBe(503)
      expect(session.isPending).toBe(false)
      expect(container.textContent).toBe('Chosen nameChosen name')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
