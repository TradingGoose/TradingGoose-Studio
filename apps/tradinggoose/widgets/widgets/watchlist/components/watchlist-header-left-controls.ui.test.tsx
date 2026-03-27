/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatchlistHeaderLeftControls } from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

const mockEmitWatchlistParamsChange = vi.fn()

vi.mock('@/widgets/utils/watchlist-params', () => ({
  emitWatchlistParamsChange: (...args: unknown[]) => mockEmitWatchlistParamsChange(...args),
}))

vi.mock('@/widgets/widgets/components/market-provider-selector', () => ({
  MarketProviderSelector: () => <div>provider-selector</div>,
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-refresh-data-button', () => ({
  WatchlistRefreshDataButton: () => <div>refresh-button</div>,
}))

vi.mock('@/widgets/widgets/watchlist/components/provider-controls', () => ({
  resolveWatchlistProviderCredentialDefinitions: (providerId?: string) =>
    providerId === 'alpaca' ? [{ id: 'apiKey' }, { id: 'apiSecret' }] : [],
  WatchlistProviderSettingsButton: (props: {
    definitions: Array<{ id: string }>
    onSave: (next: { auth?: Record<string, unknown>; providerParams?: Record<string, unknown> }) => void
  }) => {
    if (props.definitions.length === 0) return null

    return (
      <button
        type='button'
        onClick={() => props.onSave({ auth: { apiKey: 'secret' }, providerParams: { feed: 'iex' } })}
      >
        provider-settings
      </button>
    )
  },
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: () => 'controls',
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('WatchlistHeaderLeftControls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('shows provider settings only when the selected provider has credential fields', async () => {
    await act(async () => {
      root.render(
        <WatchlistHeaderLeftControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={{
            key: 'watchlist',
            params: { provider: 'yahoo-finance' },
          } as any}
        />
      )
    })

    expect(container.textContent).not.toContain('provider-settings')

    await act(async () => {
      root.render(
        <WatchlistHeaderLeftControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={{
            key: 'watchlist',
            params: { provider: 'alpaca' },
          } as any}
        />
      )
    })

    expect(container.textContent).toContain('provider-settings')
  })

  it('saves provider credentials and forces an immediate refresh', async () => {
    await act(async () => {
      root.render(
        <WatchlistHeaderLeftControls
          workspaceId='workspace-1'
          panelId='panel-7'
          widget={{
            key: 'watchlist-widget',
            params: { provider: 'alpaca', providerParams: { feed: 'sip' } },
          } as any}
        />
      )
    })

    const button = container.querySelector('button')

    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockEmitWatchlistParamsChange).toHaveBeenCalledTimes(1)
    expect(mockEmitWatchlistParamsChange).toHaveBeenCalledWith({
      params: {
        providerParams: { feed: 'iex' },
        auth: { apiKey: 'secret' },
        runtime: {
          refreshAt: expect.any(Number),
        },
      },
      panelId: 'panel-7',
      widgetKey: 'watchlist-widget',
    })
  })
})
