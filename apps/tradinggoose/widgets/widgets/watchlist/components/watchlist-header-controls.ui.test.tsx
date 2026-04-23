/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WatchlistHeaderCenterControls,
  WatchlistHeaderRightControls,
} from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

const mockUseWatchlists = vi.fn()
const mockAddWatchlistListing = vi.fn()
const mockCreateWatchlist = vi.fn()
const mockAddWatchlistSection = vi.fn()
const mockDeleteWatchlist = vi.fn()
const mockImportWatchlist = vi.fn()
const mockExportWatchlist = vi.fn()
const mockRenameWatchlist = vi.fn()

vi.mock('@/hooks/queries/watchlists', () => ({
  useWatchlists: (...args: unknown[]) => mockUseWatchlists(...args),
  useAddWatchlistListing: () => mockAddWatchlistListing(),
  useCreateWatchlist: () => mockCreateWatchlist(),
  useAddWatchlistSection: () => mockAddWatchlistSection(),
  useDeleteWatchlist: () => mockDeleteWatchlist(),
  useImportWatchlist: () => mockImportWatchlist(),
  useExportWatchlist: () => mockExportWatchlist(),
  useRenameWatchlist: () => mockRenameWatchlist(),
}))

vi.mock('@/widgets/utils/watchlist-params', () => ({
  emitWatchlistParamsChange: vi.fn(),
}))

vi.mock('@/widgets/widgets/components/listing-selector', () => ({
  ListingSelector: (props: {
    disabled?: boolean
    onListingChange?: (listing: {
      listing_id: string
      base_id: string
      quote_id: string
      listing_type: 'default'
      name?: string
    }) => void
  }) => (
    <button
      type='button'
      disabled={props.disabled}
      onClick={() =>
        props.onListingChange?.({
          listing_id: 'BTCUSD',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
          name: 'BTC/USD',
        })
      }
    >
      Select Listing
    </button>
  ),
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-list-selector', () => ({
  WatchlistListSelector: () => <div>watchlist-selector</div>,
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-list-actions-button', () => ({
  WatchlistListActionsButton: (props: {
    createSectionDisabled?: boolean
    onCreateSection: () => void
  }) => (
    <button type='button' disabled={props.createSectionDisabled} onClick={props.onCreateSection}>
      Create Section
    </button>
  ),
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
}))

const createMutationState = (mutateAsync = vi.fn()) => ({
  isPending: false,
  mutateAsync,
})

const defaultWatchlist = {
  id: 'default-watchlist',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  name: 'Default',
  isSystem: true,
  items: [],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-03-13T00:00:00.000Z',
  updatedAt: '2026-03-13T00:00:00.000Z',
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('watchlist header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockUseWatchlists.mockReturnValue({
      data: [defaultWatchlist],
    })
    mockAddWatchlistListing.mockReturnValue(createMutationState())
    mockCreateWatchlist.mockReturnValue(createMutationState())
    mockAddWatchlistSection.mockReturnValue(createMutationState())
    mockDeleteWatchlist.mockReturnValue(createMutationState())
    mockImportWatchlist.mockReturnValue(createMutationState())
    mockExportWatchlist.mockReturnValue(createMutationState())
    mockRenameWatchlist.mockReturnValue(createMutationState())
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('adds the staged listing from the center header control', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockAddWatchlistListing.mockReturnValue(createMutationState(mutateAsync))

    await act(async () => {
      root.render(
        <WatchlistHeaderCenterControls
          workspaceId='workspace-1'
          panelId='panel-2'
          widget={
            {
              key: 'watchlist-widget',
              params: {
                watchlistId: 'default-watchlist',
                provider: 'alpaca',
              },
            } as any
          }
        />
      )
    })

    expect(container.firstElementChild?.className).toContain('min-w-0')

    const buttons = Array.from(container.querySelectorAll('button'))
    const listingButton = buttons.find((button) => button.textContent?.includes('Select Listing'))
    const addButton = buttons.find((button) =>
      button.textContent?.includes('Add listing to watchlist')
    )

    expect(listingButton).toBeTruthy()
    expect(addButton?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      listingButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(addButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      addButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      watchlistId: 'default-watchlist',
      listing: {
        listing_id: 'BTCUSD',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })
    expect(addButton?.hasAttribute('disabled')).toBe(true)
  })

  it('enables section creation on the Default watchlist and creates the next section name', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockAddWatchlistSection.mockReturnValue(createMutationState(mutateAsync))
    mockUseWatchlists.mockReturnValue({
      data: [
        {
          ...defaultWatchlist,
          items: [
            { id: 'section-1', type: 'section', label: 'Section 1' },
            { id: 'section-3', type: 'section', label: 'Section 3' },
          ],
        },
      ],
    })

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={
            {
              key: 'watchlist',
              params: { watchlistId: 'default-watchlist' },
            } as any
          }
        />
      )
    })

    expect(container.firstElementChild?.className).toContain('min-w-0')

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Create Section')
    )

    expect(button).toBeTruthy()
    expect(button?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      watchlistId: 'default-watchlist',
      label: 'Section 2',
    })
  })

  it('imports watchlist files with sections and listings', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      watchlist: {
        id: 'default-watchlist',
      },
      import: {
        addedCount: 1,
        skippedCount: 0,
      },
    })
    mockImportWatchlist.mockReturnValue(createMutationState(mutateAsync))

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-4'
          widget={
            {
              key: 'watchlist-widget',
              params: { watchlistId: 'default-watchlist' },
            } as any
          }
        />
      )
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = {
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'watchlistWidget',
          resourceTypes: ['watchlists'],
          watchlists: [
            {
              name: 'Default',
              items: [
                {
                  type: 'section',
                  label: 'Tech',
                  items: [
                    {
                      type: 'listing',
                      listing: {
                        listing_id: 'aapl-id',
                        base_id: '',
                        quote_id: '',
                        listing_type: 'default',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        })
      ),
    } as unknown as File

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      watchlistId: 'default-watchlist',
      file: {
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['watchlists'],
        watchlists: [
          {
            name: 'Default',
            items: [
              {
                type: 'section',
                label: 'Tech',
                items: [
                  {
                    type: 'listing',
                    listing: {
                      listing_id: 'aapl-id',
                      base_id: '',
                      quote_id: '',
                      listing_type: 'default',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  })
})
