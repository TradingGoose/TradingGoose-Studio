/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseSession = vi.fn()
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

let container: HTMLDivElement | null = null
let root: Root | null = null
let latestValue: unknown = null

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('useUserPermissions', () => {
  beforeEach(() => {
    latestValue = null
    mockUseSession.mockReset()
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
      error: null,
    })

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
  })

  it('keeps permissions loading while the auth session is still pending', async () => {
    const { useUserPermissions } = await import('@/hooks/use-user-permissions')

    function Harness() {
      latestValue = useUserPermissions(
        {
          users: [
            {
              userId: 'user-1',
              email: 'member@example.com',
              name: 'Member',
              image: null,
              permissionType: 'admin',
            },
          ],
          total: 1,
        },
        false,
        null
      )
      return null
    }

    await act(async () => {
      root?.render(<Harness />)
    })

    expect(latestValue).toMatchObject({
      canRead: false,
      canEdit: false,
      canAdmin: false,
      isLoading: true,
      error: null,
    })
  })

  it('returns resolved permissions once the auth session is available', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'member@example.com',
        },
      },
      isPending: false,
      error: null,
    })

    const { useUserPermissions } = await import('@/hooks/use-user-permissions')

    function Harness() {
      latestValue = useUserPermissions(
        {
          users: [
            {
              userId: 'user-1',
              email: 'member@example.com',
              name: 'Member',
              image: null,
              permissionType: 'write',
            },
          ],
          total: 1,
        },
        false,
        null
      )
      return null
    }

    await act(async () => {
      root?.render(<Harness />)
    })

    expect(latestValue).toMatchObject({
      canRead: true,
      canEdit: true,
      canAdmin: false,
      isLoading: false,
      error: null,
      userPermissions: 'write',
    })
  })
})
