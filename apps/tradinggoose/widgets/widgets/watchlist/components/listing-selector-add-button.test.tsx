import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { ListingSelectorAddButton } from '@/widgets/widgets/watchlist/components/listing-selector-add-button'

const storeMocks = vi.hoisted(() => ({
  ensureInstance: vi.fn(),
  updateInstance: vi.fn(),
  instances: {},
}))

const capturedProps = vi.hoisted(() => ({
  stockSelectorClassName: '',
  popoverContentClassName: '',
}))

vi.mock('@/stores/market/selector/store', () => ({
  createEmptyListingSelectorInstance: () => ({
    providerId: null,
  }),
  useListingSelectorStore: (selector: (state: typeof storeMocks) => unknown) => selector(storeMocks),
}))

vi.mock('@/components/listing-selector/selector/input', () => ({
  StockSelector: ({ className }: { className?: string }) => {
    capturedProps.stockSelectorClassName = className ?? ''
    return <div data-testid='stock-selector' />
  },
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => {
    capturedProps.popoverContentClassName = className ?? ''
    return <div>{children}</div>
  },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderIconButtonClassName: () => 'icon-btn',
}))

describe('ListingSelectorAddButton', () => {
  beforeEach(() => {
    capturedProps.stockSelectorClassName = ''
    capturedProps.popoverContentClassName = ''
  })

  it('uses expanded layout classes so selected listings have more room', () => {
    const html = renderToStaticMarkup(
      <ListingSelectorAddButton
        instanceId='watchlist-add-1'
        workspaceId='workspace-1'
        providerId='alpaca'
        onAddListing={() => true}
      />
    )

    expect(capturedProps.popoverContentClassName).toContain('w-[min(380px,calc(100vw-2rem))]')
    expect(capturedProps.popoverContentClassName).toContain('p-2.5')
    expect(capturedProps.stockSelectorClassName).toContain('[&>div>input]:h-10')
    expect(capturedProps.stockSelectorClassName).toContain('[&>div>input]:pr-9')
    expect(capturedProps.stockSelectorClassName).toContain('[&>div>button]:h-6')
    expect(capturedProps.stockSelectorClassName).toContain('[&>div>button]:w-6')
    expect(html).toContain('class="flex items-center gap-2.5"')
  })
})
