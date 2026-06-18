/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

let container: HTMLDivElement | null = null
let root: Root | null = null
let latestValue: unknown = null

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('useUserPermissions', () => {
  beforeEach(() => {
    latestValue = null

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

  it('keeps permissions loading while workspace permissions are still pending', async () => {
    const { useUserPermissions } = await import('@/hooks/use-user-permissions')

    function Harness() {
      latestValue = useUserPermissions(null, true, null)
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

  it('returns server-derived current user permissions', async () => {
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
          currentUserPermission: 'write',
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
