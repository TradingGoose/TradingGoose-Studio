/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'

const mockUseOAuthCredentials = vi.fn()
const mockUseTradingAccounts = vi.fn()

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
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
    mockUseTradingAccounts.mockReturnValue({
      data: [
        { id: 'acct-1', name: 'Paper Account' },
        { id: 'acct-2', name: 'Live Account' },
      ],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders the selected broker account from the shared provider connection and account id', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector
            workspaceId='workspace-1'
            providerId='alpaca'
            accountId='acct-1'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Paper Account')
    expect(mockUseOAuthCredentials).toHaveBeenCalledWith('alpaca', true)
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      enabled: true,
    })
  })

  it('renders placeholder text before a provider is selected', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector placeholder='Select account' />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Select account')
    expect((button as HTMLButtonElement | null)?.disabled).toBe(true)
  })
})
