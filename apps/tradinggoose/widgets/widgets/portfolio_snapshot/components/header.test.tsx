/**
 * @vitest-environment jsdom
 */

import { EventEmitter } from 'node:events'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePortfolioDetail } from '@/hooks/queries/trading-portfolio'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { renderPortfolioSnapshotHeader } from '@/widgets/widgets/portfolio_snapshot/components/header'

const mockUseOAuthProviderAvailability = vi.fn()
const mockPatchWidgetParams = vi.fn()
const { useSocketMock } = vi.hoisted(() => ({ useSocketMock: vi.fn() }))

vi.mock('@/contexts/socket-context', () => ({ useSocket: () => useSocketMock() }))
type MockTradingAccountSelectorProps = {
  onAccountSelect?: (selection: unknown) => void
}
const mockTradingAccountSelector = vi.fn(({ onAccountSelect }: MockTradingAccountSelectorProps) => (
  <button
    type='button'
    data-testid='account-selector'
    aria-label='Select trading account'
    onClick={() =>
      onAccountSelect?.({
        portfolioIdentity: {
          providerId: 'alpaca',
          credentialId: 'oauth-account-1',
          serviceId: 'alpaca-live',
          accountId: 'acct-1',
        },
      })
    }
  >
    account
  </button>
))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: (...args: unknown[]) => mockPatchWidgetParams(...args),
  }),
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
}))

vi.mock('@/components/market-selector/provider-settings-button', () => ({
  MarketProviderSettingsButton: () => <button type='button'>Market settings</button>,
}))

vi.mock('@/components/market-selector/provider-selector', () => ({
  MarketProviderSelector: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (providerId: string) => void
  }) => (
    <button
      type='button'
      data-testid='market-provider-selector'
      onClick={() => onChange?.('alpaca')}
    >
      Market provider {value}
    </button>
  ),
}))

vi.mock('@/components/trading-selector/provider-selector', () => ({
  TradingProviderSelector: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (providerId: string) => void
  }) => (
    <button
      type='button'
      data-testid='trading-provider-selector'
      onClick={() => onChange?.('tradier')}
    >
      Trading provider {value}
    </button>
  ),
}))

vi.mock('@/components/trading-selector/account-selector', () => ({
  TradingAccountSelector: (props: MockTradingAccountSelectorProps) =>
    mockTradingAccountSelector(props),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children?: React.ReactNode
    render?: React.ReactNode
  }) => <>{render ?? children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

const createQueryResult = <T,>(overrides: Partial<T> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }) as T

describe('PortfolioSnapshotHeaderControls', () => {
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

    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({
        data: {
          'alpaca-live': true,
          'alpaca-paper': true,
          'tradier-live': true,
        },
      })
    )
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const renderHeader = async (
    params: Record<string, unknown> | null = {
      provider: 'alpaca',
      portfolioIdentity: {
        providerId: 'alpaca',
        credentialId: 'oauth-account-1',
        serviceId: 'alpaca-live',
        accountId: 'acct-1',
      },
      selectedWindow: '1D',
    }
  ) => {
    const slots = renderPortfolioSnapshotHeader?.({
      channelId: 'portfolio-snapshot-panel-1',
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'portfolio_snapshot',
        params,
      } as any,
    })

    expect(slots).toBeTruthy()

    await act(async () => {
      root.render(
        <>
          {slots?.left}
          {slots?.center}
          {slots?.right}
        </>
      )
    })
  }

  it('does not infer a market provider default from trading provider params', async () => {
    await renderHeader()

    expect(container.textContent).toContain('Market provider')
    expect(mockPatchWidgetParams).not.toHaveBeenCalledWith(
      expect.objectContaining({
        marketProvider: expect.any(String),
      })
    )
  })

  it('resets provider-scoped selections when the trading provider changes', async () => {
    await renderHeader()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="trading-provider-selector"]')
        ?.click()
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      provider: 'tradier',
      portfolioIdentity: null,
      serviceId: null,
      selectedWindow: null,
    })
  })

  it('updates the account id from account selection', async () => {
    await renderHeader()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')?.click()
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      portfolioIdentity: {
        providerId: 'alpaca',
        credentialId: 'oauth-account-1',
        serviceId: 'alpaca-live',
        accountId: 'acct-1',
      },
    })
  })

  it('renders trading provider immediately before the single account selector', async () => {
    await renderHeader()

    const providerButton = container.querySelector('[data-testid="trading-provider-selector"]')
    const accountButton = container.querySelector('[data-testid="account-selector"]')

    expect(providerButton).toBeTruthy()
    expect(accountButton).toBeTruthy()
    expect(container.textContent).not.toContain('Provider settings')

    if (!providerButton || !accountButton) {
      throw new Error('Expected provider and account selector controls')
    }

    expect(
      providerButton.compareDocumentPosition(accountButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('emits a runtime refresh timestamp when the refresh button is clicked', async () => {
    await renderHeader()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Refresh portfolio snapshot"]')
        ?.click()
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      runtime: {
        refreshAt: expect.any(Number),
      },
    })
  })

  it('hides trading controls when no trading providers are configured', async () => {
    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({
        data: {},
      })
    )

    await renderHeader()

    expect(container.querySelector('[data-testid="trading-provider-selector"]')).toBeNull()
    expect(container.querySelector('[data-testid="account-selector"]')).toBeNull()
  })

  it('requires selecting a trading provider before showing the account selector', async () => {
    await renderHeader(null)

    expect(container.querySelector('[data-testid="trading-provider-selector"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="account-selector"]')).toBeNull()
  })
})

class PortfolioTestSocket extends EventEmitter {
  connected = true
  calls: Array<[string, any]> = []
  emit(event: string, payload: any) {
    this.calls.push([event, payload])
    return true
  }
  receive(event: string, payload?: any) {
    super.emit(event, payload)
  }
  payloads(event: string) {
    return this.calls.filter(([name]) => name === event).map(([, payload]) => payload)
  }
}

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'credential-1',
  serviceId: 'alpaca-live',
  accountId: 'acct-1',
} as PortfolioIdentity
const portfolioDetail = {
  ...portfolioIdentity,
  summary: { totalPortfolioValue: 1000, totalCashValue: 100 },
} as NonNullable<ReturnType<typeof usePortfolioDetail>['data']>
type DetailResult = ReturnType<typeof usePortfolioDetail>
let portfolioResults: Record<string, DetailResult>

function PortfolioProbe({ id = 'probe', workspaceId = 'workspace-1' }) {
  portfolioResults[id] = usePortfolioDetail({
    workspaceId,
    provider: 'alpaca',
    serviceId: 'alpaca-live',
    portfolioIdentity,
  })
  return (
    <output data-testid={id}>{portfolioResults[id].data?.summary.totalPortfolioValue ?? ''}</output>
  )
}

describe('trading portfolio socket query', () => {
  let container: HTMLDivElement
  let root: Root
  let socket: PortfolioTestSocket
  const render = (node: ReactNode) => act(() => root.render(node))
  const receive = (event: string, payload?: any) => act(() => socket.receive(event, payload))
  const subscribe = (index = 0) => socket.payloads('trading-portfolio-subscribe')[index]
  const acknowledge = (clientSubscriptionId: string, subscriptionId: string) =>
    receive('trading-portfolio-subscribed', { clientSubscriptionId, subscriptionId })
  const snapshot = (clientSubscriptionId: string, subscriptionId: string, refreshId?: string) => ({
    clientSubscriptionId,
    subscriptionId,
    portfolioDetail,
    ...(refreshId ? { refreshId } : {}),
  })
  const startRefetch = () => {
    let pending!: ReturnType<DetailResult['refetch']>
    act(() => {
      pending = portfolioResults.probe.refetch()
    })
    return pending
  }
  const mountAcknowledged = (subscriptionId: string) => {
    render(<PortfolioProbe />)
    const initial = subscribe()
    acknowledge(initial.clientSubscriptionId, subscriptionId)
    return initial
  }
  const settle = (pending: ReturnType<DetailResult['refetch']>, payload: unknown) =>
    act(async () => {
      socket.receive('trading-portfolio-snapshot', payload)
      await pending
    })

  beforeEach(() => {
    portfolioResults = {}
    socket = new PortfolioTestSocket()
    useSocketMock.mockReturnValue({ socket })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('isolates hook instances by acknowledged server subscription', async () => {
    render(
      <>
        <PortfolioProbe id='first' />
        <PortfolioProbe id='second' />
      </>
    )
    const [first, second] = socket.payloads('trading-portfolio-subscribe')
    expect(first.clientSubscriptionId).not.toBe(second.clientSubscriptionId)
    acknowledge(first.clientSubscriptionId, 'server-first')
    receive('trading-portfolio-snapshot', snapshot(first.clientSubscriptionId, 'server-wrong'))
    expect(container.querySelector('[data-testid="first"]')).toHaveTextContent('')
    receive('trading-portfolio-snapshot', snapshot(first.clientSubscriptionId, 'server-first'))
    expect(container.querySelector('[data-testid="first"]')).toHaveTextContent('1000')
    expect(container.querySelector('[data-testid="second"]')).toHaveTextContent('')
    const staleRefetch = portfolioResults.first.refetch
    act(() => root.unmount())
    root = createRoot(container)
    expect((await staleRefetch()).error?.message).toBe(
      'Trading portfolio subscription is unavailable'
    )
  })

  it('settles only the owned refresh token and times out bounded work', async () => {
    vi.useFakeTimers()
    const initial = mountAcknowledged('server-1')
    const pending = startRefetch()
    const refresh = socket.payloads('trading-portfolio-refresh').at(-1)
    expect(refresh.subscriptionId).toBe('server-1')
    receive(
      'trading-portfolio-snapshot',
      snapshot(initial.clientSubscriptionId, 'server-1', 'wrong')
    )
    expect(portfolioResults.probe.isFetching).toBe(true)
    await settle(pending, snapshot(initial.clientSubscriptionId, 'server-1', refresh.refreshId))
    await expect(pending).resolves.toEqual({ data: portfolioDetail, error: null })
    const timedOut = startRefetch()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect((await timedOut).error?.message).toBe('Trading portfolio refresh timed out')
  })

  it('clears stale ownership on disconnect and accepts only the reconnect acknowledgement', async () => {
    const initial = mountAcknowledged('server-old')
    const disconnected = startRefetch()
    await act(async () => {
      socket.connected = false
      socket.receive('disconnect')
      await disconnected
    })
    expect((await disconnected).error?.message).toBe('Trading portfolio connection was lost')
    act(() => {
      socket.connected = true
      socket.receive('connect')
    })
    acknowledge(initial.clientSubscriptionId, 'server-new')
    receive('trading-portfolio-snapshot', snapshot(initial.clientSubscriptionId, 'server-old'))
    expect(container.querySelector('output')).toHaveTextContent('')
    const pending = startRefetch()
    const refresh = socket.payloads('trading-portfolio-refresh').at(-1)
    expect(refresh.subscriptionId).toBe('server-new')
    await settle(pending, snapshot(initial.clientSubscriptionId, 'server-new', refresh.refreshId))
    await expect(pending).resolves.toEqual({ data: portfolioDetail, error: null })
  })
})
