/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHeatmapHeader } from '@/widgets/widgets/heatmap/components/header'

const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseTradingAccounts = vi.fn()
const mockEmitHeatmapParamsChange = vi.fn()

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
}))

vi.mock('@/widgets/utils/heatmap-params', () => ({
  emitHeatmapParamsChange: (...args: unknown[]) => mockEmitHeatmapParamsChange(...args),
}))

vi.mock('@/widgets/widgets/components/market-provider-settings-button', () => ({
  MarketProviderSettingsButton: () => <button type='button'>Market settings</button>,
}))

vi.mock('@/widgets/widgets/components/market-provider-selector', () => ({
  MarketProviderSelector: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (providerId: string) => void
  }) => (
    <button type='button' onClick={() => onChange?.('alpaca')}>
      Market provider {value}
    </button>
  ),
}))

vi.mock('@/widgets/widgets/components/trading-provider-selector', () => ({
  TradingProviderSelector: () => <select aria-label='Trading provider' />,
}))

vi.mock('@/widgets/widgets/components/trading-account-selector', () => ({
  TradingAccountSelector: () => <button type='button'>Trading account</button>,
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal',
  () => ({
    OAuthRequiredModal: () => null,
  })
)

const createQueryResult = <T,>(overrides: Partial<T> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }) as T

describe('HeatmapHeaderControls', () => {
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
          alpaca: true,
        },
      })
    )
    mockUseOAuthCredentials.mockReturnValue(createQueryResult({ data: [] }))
    mockUseTradingAccounts.mockReturnValue(createQueryResult({ data: [] }))
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('normalizes an invalid persisted market provider from the header controls', async () => {
    const slots = renderHeatmapHeader?.({
      panelId: 'panel-1',
      widget: {
        key: 'heatmap',
        params: {
          sourceMode: 'watchlist',
          marketProvider: 'unsupported-provider',
        },
      } as any,
    })

    await act(async () => {
      root.render(
        <>
          {slots?.left}
          {slots?.center}
          {slots?.right}
        </>
      )
    })

    expect(mockEmitHeatmapParamsChange).toHaveBeenCalledWith({
      params: {
        marketProvider: expect.not.stringMatching(/^unsupported-provider$/),
      },
      panelId: 'panel-1',
      widgetKey: 'heatmap',
    })
    expect(mockUseOAuthProviderAvailability).not.toHaveBeenCalled()
    expect(mockUseOAuthCredentials).not.toHaveBeenCalled()
    expect(mockUseTradingAccounts).not.toHaveBeenCalled()
  })
})
