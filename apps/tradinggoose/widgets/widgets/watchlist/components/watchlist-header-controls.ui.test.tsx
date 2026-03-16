/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WATCHLIST_WIDGET_ADD_DRAFT_SYMBOL_EVENT } from '@/widgets/events'
import { WatchlistHeaderRightControls } from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

const mockUseWatchlists = vi.fn()
const mockCreateWatchlist = vi.fn()
const mockAddWatchlistSection = vi.fn()
const mockDeleteWatchlist = vi.fn()
const mockClearWatchlist = vi.fn()
const mockImportWatchlist = vi.fn()
const mockExportWatchlist = vi.fn()

vi.mock('@/hooks/queries/watchlists', () => ({
  useWatchlists: (...args: unknown[]) => mockUseWatchlists(...args),
  useCreateWatchlist: () => mockCreateWatchlist(),
  useAddWatchlistSection: () => mockAddWatchlistSection(),
  useDeleteWatchlist: () => mockDeleteWatchlist(),
  useClearWatchlist: () => mockClearWatchlist(),
  useImportWatchlist: () => mockImportWatchlist(),
  useExportWatchlist: () => mockExportWatchlist(),
  useAddWatchlistListing: vi.fn(),
  useRenameWatchlist: vi.fn(),
}))

vi.mock('@/widgets/utils/watchlist-params', () => ({
  emitWatchlistParamsChange: vi.fn(),
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-list-actions-button', () => ({
  WatchlistListActionsButton: (props: {
    addSymbolDisabled?: boolean
    onAddSymbol: () => void
    createSectionDisabled?: boolean
    onCreateSection: () => void
  }) => (
    <>
      <button type='button' disabled={props.addSymbolDisabled} onClick={props.onAddSymbol}>
        Add Symbol
      </button>
      <button
        type='button'
        disabled={props.createSectionDisabled}
        onClick={props.onCreateSection}
      >
        Create Section
      </button>
    </>
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

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: () => 'controls',
}))

const createMutationState = (mutateAsync = vi.fn()) => ({
  isPending: false,
  mutateAsync,
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('WatchlistHeaderRightControls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockUseWatchlists.mockReturnValue({
      data: [
        {
          id: 'default-watchlist',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: 'Default',
          isSystem: true,
          items: [],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '2026-03-13T00:00:00.000Z',
          updatedAt: '2026-03-13T00:00:00.000Z',
        },
      ],
    })
    mockCreateWatchlist.mockReturnValue(createMutationState())
    mockAddWatchlistSection.mockReturnValue(createMutationState())
    mockDeleteWatchlist.mockReturnValue(createMutationState())
    mockClearWatchlist.mockReturnValue(createMutationState())
    mockImportWatchlist.mockReturnValue(createMutationState())
    mockExportWatchlist.mockReturnValue(createMutationState())
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('enables section creation on the Default watchlist and creates the next section name', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockAddWatchlistSection.mockReturnValue(createMutationState(mutateAsync))
    mockUseWatchlists.mockReturnValue({
      data: [
        {
          id: 'default-watchlist',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: 'Default',
          isSystem: true,
          items: [
            { id: 'section-1', type: 'section', label: 'Section 1' },
            { id: 'section-3', type: 'section', label: 'Section 3' },
          ],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '2026-03-13T00:00:00.000Z',
          updatedAt: '2026-03-13T00:00:00.000Z',
        },
      ],
    })

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={{
            key: 'watchlist',
            params: { watchlistId: 'default-watchlist' },
          } as any}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Create Section')
    )

    expect(button).toBeTruthy()
    expect(button?.textContent).toContain('Create Section')
    expect(button?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      watchlistId: 'default-watchlist',
      label: 'Section 2',
    })
  })

  it('dispatches an add-symbol widget event from list actions', async () => {
    const eventHandler = vi.fn()
    window.addEventListener(WATCHLIST_WIDGET_ADD_DRAFT_SYMBOL_EVENT, eventHandler as EventListener)

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-9'
          widget={{
            key: 'watchlist-widget',
            params: { watchlistId: 'default-watchlist' },
          } as any}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Add Symbol')
    )

    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(eventHandler).toHaveBeenCalledTimes(1)
    expect((eventHandler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      panelId: 'panel-9',
      widgetKey: 'watchlist-widget',
    })

    window.removeEventListener(
      WATCHLIST_WIDGET_ADD_DRAFT_SYMBOL_EVENT,
      eventHandler as EventListener
    )
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
          widget={{
            key: 'watchlist-widget',
            params: { watchlistId: 'default-watchlist' },
          } as any}
        />
      )
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = {
      text: vi.fn().mockResolvedValue(
        JSON.stringify([
          { id: 'section-1', type: 'section', label: 'Tech' },
          {
            id: 'listing-1',
            type: 'listing',
            listing: {
              listing_id: 'aapl-id',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
        ])
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
      items: [
        { id: 'section-1', type: 'section', label: 'Tech' },
        {
          id: 'listing-1',
          type: 'listing',
          listing: {
            listing_id: 'aapl-id',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })
  })
})
