/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_TIER_ACCESS_ERROR_CODES } from '@/lib/billing/private-tier-access-contract'
import {
  getPrivateTierAccessErrorCode,
  type PrivateTierAccessResponse,
  privateTierAccessKey,
  usePrivateTierAccess,
  usePrivateTierAccessMutation,
} from './private-tier-access'

let grantAccess: ((accessCode: string) => void) | null = null

function PrivateTierAccessHarness() {
  const query = usePrivateTierAccess()
  const mutation = usePrivateTierAccessMutation()
  grantAccess = mutation.mutate

  return (
    <div>
      <span data-testid='tiers'>
        {query.data?.privateTiers.map((tier) => tier.displayName).join(',') ?? ''}
      </span>
      <span data-testid='error'>{getPrivateTierAccessErrorCode(mutation.error) ?? ''}</span>
    </div>
  )
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('private tier access queries', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    grantAccess = null
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  function renderHarness() {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PrivateTierAccessHarness />
        </QueryClientProvider>
      )
    })
  }

  it('aborts an older read and reconciles after a successful grant', async () => {
    const grantedTier = {
      id: 'tier-private',
      displayName: 'Private Tier',
      description: '',
      ownerType: 'user' as const,
      seatMode: 'fixed' as const,
      usageScope: 'individual' as const,
      displayOrder: 1,
      monthlyPriceUsd: 20,
      yearlyPriceUsd: null,
      seatCount: null,
      seatMaximum: null,
      canEditUsageLimit: false,
      pricingFeatures: [],
      isDefault: false,
    }
    let getCount = 0
    let originalReadAborted = false

    global.fetch = vi.fn((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      getCount += 1
      if (getCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            originalReadAborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      }

      return Promise.resolve(Response.json({ privateTiers: [grantedTier] }))
    })

    renderHarness()
    await act(flushAsyncWork)

    await act(async () => {
      grantAccess?.('private-access-code')
      await flushAsyncWork()
      await flushAsyncWork()
    })

    expect(originalReadAborted).toBe(true)
    expect(getCount).toBe(2)
    expect(container.querySelector('[data-testid="tiers"]')?.textContent).toBe('Private Tier')
    expect(queryClient.getQueryData<PrivateTierAccessResponse>(privateTierAccessKey)).toEqual({
      privateTiers: [grantedTier],
    })
  })

  it('preserves stable server error codes on failed grants', async () => {
    global.fetch = vi.fn((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? Response.json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.invalid }, { status: 404 })
          : Response.json({ privateTiers: [] })
      )
    )

    renderHarness()
    await act(flushAsyncWork)

    await act(async () => {
      grantAccess?.('invalid-private-access-code')
      await flushAsyncWork()
      await flushAsyncWork()
    })

    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
      PRIVATE_TIER_ACCESS_ERROR_CODES.invalid
    )
  })
})
