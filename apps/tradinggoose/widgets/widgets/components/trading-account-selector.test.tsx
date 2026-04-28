/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'

const mockUseOAuthCredentials = vi.fn()
const mockUseQueries = vi.fn()

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')

  return {
    ...actual,
    useQueries: (...args: unknown[]) => mockUseQueries(...args),
  }
})

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

describe('TradingAccountSelector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockUseOAuthCredentials.mockReturnValue({
      data: [{ id: 'cred-1', name: 'Primary Broker', provider: 'alpaca' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseQueries.mockReturnValue([
      {
        data: [{ id: 'acct-1', name: 'Paper Account' }],
        isLoading: false,
        isFetching: false,
        error: null,
      },
      {
        data: [{ id: 'acct-2', name: 'Live Account' }],
        isLoading: false,
        isFetching: false,
        error: null,
      },
    ])
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders the selected broker account from credential, environment, and account id', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector
            providerId='alpaca'
            environmentOptions={[
              { id: 'paper', label: 'Paper' },
              { id: 'live', label: 'Live' },
            ]}
            credentialId='cred-1'
            environment='paper'
            accountId='acct-1'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Paper Account')
    expect(mockUseOAuthCredentials).toHaveBeenCalledWith('alpaca', true)
  })

  it('renders placeholder text before a provider is selected', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector environmentOptions={[]} placeholder='Select account' />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Select account')
    expect((button as HTMLButtonElement | null)?.disabled).toBe(true)
  })
})
