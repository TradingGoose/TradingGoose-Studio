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
  useOAuthCredentialsByProviderIds: (...args: unknown[]) => mockUseOAuthCredentials(...args),
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
      data: {
        'alpaca-live': [{ id: 'cred-1', name: 'Primary Broker', provider: 'alpaca-live' }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseTradingAccounts.mockReturnValue({
      data: [
        {
          id: 'acct-1',
          name: 'Alpaca Account',
          type: 'cash',
          status: 'active',
          baseCurrency: 'USD',
        },
        {
          id: 'acct-2',
          name: 'Live Account',
          type: 'margin',
          status: 'active',
          baseCurrency: 'USD',
        },
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
    expect(button?.textContent).toContain('Alpaca Account')
    expect(mockUseOAuthCredentials).toHaveBeenCalledWith(['alpaca-live', 'alpaca-paper'], true)
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      credentialServiceId: 'alpaca-live',
      enabled: true,
    })
  })

  it('renders normalized account metadata in account menu descriptions', () => {
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

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Select trading account"]'
    )
    act(() => {
      button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('cash - active - USD')
    expect(document.body.textContent).not.toContain('unknown - active - USD')
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

  it('shows loading text instead of an unresolved account id while accounts load', () => {
    mockUseTradingAccounts.mockReturnValue({
      data: [],
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    })

    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector
            workspaceId='workspace-1'
            providerId='alpaca'
            accountId='8b594a8c-1353-40d0-981c-e022a879e0e0'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Loading account...')
    expect(button?.textContent).not.toContain('8b594a8c-1353-40d0-981c-e022a879e0e0')
  })

  it('shows placeholder text instead of a stale account id after accounts load', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector
            workspaceId='workspace-1'
            providerId='alpaca'
            accountId='stale-account-id'
            placeholder='Select account'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Select account')
    expect(button?.textContent).not.toContain('stale-account-id')
  })
})
