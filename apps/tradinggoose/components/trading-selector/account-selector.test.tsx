/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TradingAccountSelector } from '@/components/trading-selector/account-selector'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getPublicCopy } from '@/i18n/public-copy'
import { formatTemplate } from '@/i18n/utils'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'

const mockUsePortfolioIdentities = vi.fn()
const mockUseTradingServices = vi.fn()

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  usePortfolioIdentities: (...args: unknown[]) => mockUsePortfolioIdentities(...args),
}))

vi.mock('@/components/trading-selector/services', () => ({
  getTradingServiceName: vi.fn(() => 'Primary Broker'),
  useTradingServices: (...args: unknown[]) => mockUseTradingServices(...args),
}))

describe('TradingAccountSelector', () => {
  let container: HTMLDivElement
  let root: Root
  const selectedPortfolioIdentity: PortfolioIdentity = {
    providerId: 'alpaca',
    credentialId: 'oauth-credential-1',
    serviceId: 'alpaca-live',
    accountId: 'acct-1',
  }
  const queryState = { isLoading: false, isFetching: false, error: null, refetch: vi.fn() }
  const services = {
    ...queryState,
    serviceIds: ['alpaca-live', 'alpaca-paper'],
    connectedServiceIds: ['alpaca-live'],
    activeServiceId: 'alpaca-live',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockUseTradingServices.mockReturnValue(services)
    mockUsePortfolioIdentities.mockReturnValue({
      ...queryState,
      data: [
        {
          ...selectedPortfolioIdentity,
          accountName: 'Alpaca Account',
          accountType: 'cash',
          accountStatus: 'active',
          baseCurrency: 'USD',
        },
        {
          providerId: 'alpaca',
          credentialId: 'oauth-credential-1',
          serviceId: 'alpaca-live',
          accountId: 'acct-2',
          accountName: 'Live Account',
          accountType: 'margin',
          accountStatus: 'active',
          baseCurrency: 'USD',
        },
      ],
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const renderWithLocale = (locale: 'en' | 'es' | 'zh', node: ReactNode) => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <TooltipProvider>{node}</TooltipProvider>
        </NextIntlClientProvider>
      )
    })
  }

  it('renders the selected broker account from the shared provider connection and account id', () => {
    const copy = getPublicCopy('en').workspace.widgets.providerControls.accountSelector
    renderWithLocale(
      'en',
      <TradingAccountSelector
        providerId='alpaca'
        serviceId='alpaca-live'
        portfolioIdentity={selectedPortfolioIdentity}
      />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain('Alpaca Account')
    expect(mockUseTradingServices).toHaveBeenCalledWith({
      providerId: 'alpaca',
      serviceId: 'alpaca-live',
      enabled: true,
    })
    expect(mockUsePortfolioIdentities).toHaveBeenCalledWith({
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      enabled: true,
    })
  })

  it('renders normalized account metadata in account menu descriptions', () => {
    const copy = getPublicCopy('en').workspace.widgets.providerControls.accountSelector
    renderWithLocale(
      'en',
      <TradingAccountSelector
        providerId='alpaca'
        serviceId='alpaca-live'
        portfolioIdentity={selectedPortfolioIdentity}
      />
    )

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.ariaLabel}"]`
    )
    act(() => {
      button?.click()
    })

    expect(document.body.textContent).toContain('Primary Broker - cash - active - USD')
    expect(document.body.textContent).not.toContain('Primary Broker - unknown - active - USD')
  })

  it('renders localized placeholder text before a provider is selected', () => {
    const copy = getPublicCopy('es').workspace.widgets.providerControls.accountSelector
    renderWithLocale('es', <TradingAccountSelector />)

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.ariaLabel}"]`
    )
    expect(button?.textContent).toContain(copy.placeholder)
    expect(button?.disabled).toBe(true)
    act(() => {
      button?.click()
    })
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  it('shows loading text instead of an unresolved account id while accounts load', () => {
    const copy = getPublicCopy('zh').workspace.widgets.providerControls.accountSelector
    mockUsePortfolioIdentities.mockReturnValue({
      data: [],
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    })

    renderWithLocale(
      'zh',
      <TradingAccountSelector
        providerId='alpaca'
        serviceId='alpaca-live'
        portfolioIdentity={{
          providerId: 'alpaca',
          credentialId: 'oauth-credential-1',
          serviceId: 'alpaca-live',
          accountId: '8b594a8c-1353-40d0-981c-e022a879e0e0',
        }}
      />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain(copy.loadingAccount)
    expect(button?.textContent).not.toContain('8b594a8c-1353-40d0-981c-e022a879e0e0')
  })

  it('shows placeholder text instead of a stale account id after accounts load', () => {
    const copy = getPublicCopy('en').workspace.widgets.providerControls.accountSelector
    renderWithLocale(
      'en',
      <TradingAccountSelector
        providerId='alpaca'
        serviceId='alpaca-live'
        portfolioIdentity={{
          providerId: 'alpaca',
          credentialId: 'oauth-credential-1',
          serviceId: 'alpaca-live',
          accountId: 'stale-account-id',
        }}
      />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain(copy.placeholder)
    expect(button?.textContent).not.toContain('stale-account-id')
  })

  it.each([
    ['valid account', {}, {}, {}, false],
    [
      'partial account list from another connection',
      {},
      { data: [{ ...selectedPortfolioIdentity, credentialId: 'oauth-credential-2' }] },
      {},
      false,
    ],
    ['shared account absent from viewer list', {}, { data: [] }, {}, false],
    [
      'shared service absent from viewer connections',
      { connectedServiceIds: [], activeServiceId: undefined },
      { data: undefined },
      {},
      false,
    ],
    ['globally unavailable service', { serviceIds: [] }, {}, {}, true],
    ['opted out', { serviceIds: [] }, {}, { clearInvalidSelection: undefined }, false],
    ['disabled', { serviceIds: [] }, {}, { disabled: true }, false],
    ['service loading', { serviceIds: [], isLoading: true }, {}, {}, false],
    ['service fetching', { serviceIds: [], isFetching: true }, {}, {}, false],
    ['service error', { serviceIds: [], error: new Error('connections failed') }, {}, {}, false],
  ] as const)('reconciles selection for %s', (_, servicePatch, accountPatch, props, invalid) => {
    const onAccountSelect = vi.fn()
    mockUseTradingServices.mockReturnValue({ ...services, ...servicePatch })
    mockUsePortfolioIdentities.mockReturnValue({
      ...queryState,
      data: [selectedPortfolioIdentity],
      ...accountPatch,
    })
    renderWithLocale(
      'en',
      <TradingAccountSelector
        providerId='alpaca'
        serviceId='alpaca-live'
        portfolioIdentity={selectedPortfolioIdentity}
        clearInvalidSelection
        onAccountSelect={onAccountSelect}
        {...props}
      />
    )
    expect(onAccountSelect).toHaveBeenCalledTimes(invalid ? 1 : 0)
    if (invalid) {
      expect(onAccountSelect).toHaveBeenCalledWith({ serviceId: null, portfolioIdentity: null })
    }
  })

  it('uses form input styling when requested', () => {
    const copy = getPublicCopy('en').workspace.widgets.providerControls.accountSelector
    renderWithLocale(
      'en',
      <TradingAccountSelector
        providerId='alpaca'
        serviceId='alpaca-live'
        portfolioIdentity={selectedPortfolioIdentity}
        variant='form'
      />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain('Alpaca Account')
    expect(button?.className).toContain('h-10')
    expect(button?.className).toContain('rounded-md')
  })

  it('renders localized loading copy while provider connections are loading', () => {
    const copy = getPublicCopy('es').workspace.widgets.providerControls.accountSelector
    mockUseTradingServices.mockReturnValue({
      serviceIds: ['alpaca-live'],
      connectedServiceIds: [],
      activeServiceId: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })

    renderWithLocale('es', <TradingAccountSelector providerId='alpaca' />)

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.ariaLabel}"]`
    )
    act(() => {
      button?.click()
    })

    expect(document.body.textContent).toContain(copy.loadingProviderConnection)
  })

  it('renders localized empty-state copy when no provider account is connected', () => {
    const copy = getPublicCopy('zh').workspace.widgets.providerControls.accountSelector
    mockUseTradingServices.mockReturnValue({
      serviceIds: ['alpaca-live'],
      connectedServiceIds: [],
      activeServiceId: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    renderWithLocale('zh', <TradingAccountSelector providerId='alpaca' />)

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.ariaLabel}"]`
    )
    act(() => {
      button?.click()
    })

    expect(document.body.textContent).toContain(
      formatTemplate(copy.noAccountConnected, { providerName: 'Alpaca' })
    )
  })

  it('renders localized connection chooser and connect action copy in the account menu', () => {
    const copy = getPublicCopy('es').workspace.widgets.providerControls.accountSelector
    mockUseTradingServices.mockReturnValue({
      serviceIds: ['alpaca-live', 'alpaca-paper'],
      connectedServiceIds: ['alpaca-live'],
      activeServiceId: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUsePortfolioIdentities.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })

    renderWithLocale('es', <TradingAccountSelector providerId='alpaca' serviceId='alpaca-live' />)

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy.ariaLabel}"]`
    )
    act(() => {
      button?.click()
    })

    expect(document.body.textContent).toContain(
      formatTemplate(copy.selectConnection, { providerName: 'Alpaca' })
    )
    expect(document.body.textContent).toContain(
      formatTemplate(copy.reconnectAccount, { providerName: 'Primary Broker' })
    )
    expect(document.body.textContent).toContain(
      formatTemplate(copy.connectAccount, { providerName: 'Primary Broker' })
    )
  })
})
