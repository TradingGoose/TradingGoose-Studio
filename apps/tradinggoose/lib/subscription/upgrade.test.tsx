/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingUpgradeTarget } from './upgrade'
import { useSubscriptionUpgrade } from './upgrade'

const { mockInvalidateQueries, mockUpgrade } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockUpgrade: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
  useSubscription: () => ({
    upgrade: (...args: unknown[]) => mockUpgrade(...args),
  }),
}))

vi.mock('@/hooks/queries/organization', () => ({
  organizationKeys: {
    lists: () => ['organizations', 'list'],
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
const organizationTarget: BillingUpgradeTarget = {
  billingTierId: 'team-new',
  displayName: 'New Team',
  ownerType: 'organization',
  usageScope: 'pooled',
  seatMode: 'adjustable',
  seatCount: 2,
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let handleUpgrade: ReturnType<typeof useSubscriptionUpgrade>['handleUpgrade'] | null = null
let originalFetch: typeof globalThis.fetch

function UpgradeHarness() {
  handleUpgrade = useSubscriptionUpgrade().handleUpgrade
  return null
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('useSubscriptionUpgrade', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    handleUpgrade = null
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () =>
      Response.json({ organizations: [{ id: 'org-1', role: 'owner' }] })
    )
    mockUpgrade.mockResolvedValue({ data: {}, error: null })
    mockInvalidateQueries.mockResolvedValue(undefined)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<UpgradeHarness />)
    })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    globalThis.fetch = originalFetch
  })

  it('throws Better Auth upgrade result errors', async () => {
    mockUpgrade.mockResolvedValue({
      data: null,
      error: { message: 'Plan change denied' },
    })

    await expect(handleUpgrade?.(organizationTarget, { organizationId: 'org-1' })).rejects.toThrow(
      'Failed to upgrade New Team: Plan change denied'
    )
    expect(mockUpgrade.mock.calls[0]?.[0]).not.toHaveProperty('customerType')
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })
})
