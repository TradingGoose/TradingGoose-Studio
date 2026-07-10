'use client'

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from 'react'
import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type DragOverEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ChevronRight, Pencil, Trash2, X } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { getListingPrimary, MarketListingRow } from '@/components/listing-selector/listing/row'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Sortable, SortableContent, SortableItem } from '@/components/ui/sortable'
import {
  areListingIdentitiesEqual,
  buildListingDisplayOption,
  type ListingIdentity,
  type ListingOption,
  toListingValue,
} from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import { cn } from '@/lib/utils'
import type {
  WatchlistContainerItem,
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
} from '@/lib/watchlists/types'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import {
  createWatchlistContainerSortableId,
  createWatchlistListingSortableId,
  moveWatchlistItem,
  resolveEffectiveDropTarget,
  WATCHLIST_ROOT_SORTABLE_ID,
  type WatchlistDropTarget,
} from '@/widgets/widgets/watchlist/components/watchlist-reorder'
import {
  resolveWatchlistAssetClass,
  resolveWatchlistValueColorClass,
} from '@/widgets/widgets/watchlist/components/watchlist-table-utils'

type WatchlistTableProps = {
  watchlist: WatchlistRecord | null
  quotes: Record<string, MarketQuoteSnapshot>
  providerId?: string
  onUpdateItemListing: (itemId: string, listing: ListingIdentity) => Promise<boolean> | boolean
  onReorderItems: (items: WatchlistItem[]) => Promise<void>
  onRemoveItem: (itemId: string) => Promise<void> | void
  onRenameContainer: (containerId: string, label: string) => Promise<void> | void
  onRemoveContainer: (containerId: string) => Promise<void> | void
  isMutating?: boolean
  selectedListing?: ListingIdentity | null
  isLinkedSelection?: boolean
  onSelectListing?: (listing: ListingIdentity | null) => void
}

type ListingRowEntry = {
  item: WatchlistListingItem
  listing: ListingIdentity
  itemId: string
  isSectionChild: boolean
}

type WatchlistTableBlock =
  | { type: 'listing'; row: ListingRowEntry }
  | { type: 'container'; container: ContainerBlock }

type ContainerBlock = {
  container: WatchlistContainerItem
  children: ListingRowEntry[]
}

type ResolvedListingEntry = {
  identity: ListingIdentity
  resolved: ListingOption | null
}

type ListingToDelete = {
  id: string
  label: string
}

const COLUMN_COUNT = 6

const formatPrice = (value: number | null, locale: string) =>
  value == null
    ? '-'
    : new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
const formatPercent = (value: number | null, locale: string) =>
  value == null
    ? '-'
    : `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)}%`

const stopSortableActivation = (
  event:
    | ReactMouseEvent<HTMLElement>
    | ReactPointerEvent<HTMLElement>
    | ReactTouchEvent<HTMLElement>
) => {
  event.stopPropagation()
}

const buildListingEditorInstanceId = (itemId: string) => `watchlist-listing-editor-${itemId}`

const buildListingEditSurfaceId = (itemId: string) => `watchlist-listing-edit-surface-${itemId}`

export const WatchlistTable = ({
  watchlist,
  quotes,
  providerId,
  onUpdateItemListing,
  onReorderItems,
  onRemoveItem,
  onRenameContainer,
  onRemoveContainer,
  isMutating = false,
  selectedListing = null,
  isLinkedSelection = false,
  onSelectListing,
}: WatchlistTableProps) => {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.watchlist.body
  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)
  const resetListingSelectorInstance = useListingSelectorStore((state) => state.resetInstance)
  const [resolvedByItemId, setResolvedByItemId] = useState<Record<string, ResolvedListingEntry>>({})
  const [expandedContainers, setExpandedContainers] = useState<Record<string, boolean>>({})
  const [dropTarget, setDropTarget] = useState<WatchlistDropTarget | null>(null)
  const [listingToDelete, setListingToDelete] = useState<ListingToDelete | null>(null)
  const [containerToDelete, setContainerToDelete] = useState<WatchlistContainerItem | null>(null)
  const [editingContainerId, setEditingContainerId] = useState<string | null>(null)
  const [editingContainerLabel, setEditingContainerLabel] = useState('')
  const [activeContainerId, setActiveContainerId] = useState<string | null>(null)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [editingListingId, setEditingListingId] = useState<string | null>(null)
  const containerRenameInputRef = useRef<HTMLInputElement | null>(null)

  const parsedRows = useMemo(() => {
    const allRows: ListingRowEntry[] = []
    const allContainers: ContainerBlock[] = []
    const items = watchlist?.items ?? []
    const listingRowsByParent = new Map<string, ListingRowEntry[]>()

    for (const item of items) {
      if (item.type !== 'listing' || !item.parentId) continue
      const row = {
        item,
        listing: item.listing,
        itemId: item.id,
        isSectionChild: true,
      }
      listingRowsByParent.set(item.parentId, [
        ...(listingRowsByParent.get(item.parentId) ?? []),
        row,
      ])
    }

    const rootBlocks: WatchlistTableBlock[] = []
    for (const item of items) {
      if (item.type === 'listing') {
        if (item.parentId) continue
        const row = {
          item,
          listing: item.listing,
          itemId: item.id,
          isSectionChild: false,
        }
        allRows.push(row)
        rootBlocks.push({ type: 'listing', row })
        continue
      }

      const container = {
        container: item,
        children: listingRowsByParent.get(item.id) ?? [],
      }
      allRows.push(...container.children)
      allContainers.push(container)
      rootBlocks.push({ type: 'container', container })
    }

    return {
      rootBlocks,
      allRows,
      allContainers,
    }
  }, [watchlist])

  const listingRows = parsedRows.allRows

  useEffect(() => {
    setExpandedContainers((current) => {
      const next: Record<string, boolean> = {}
      parsedRows.allContainers.forEach((container) => {
        next[container.container.id] = current[container.container.id] ?? true
      })
      return next
    })
  }, [parsedRows.allContainers])

  useEffect(() => {
    const pending = listingRows.filter((entry) => {
      const cached = resolvedByItemId[entry.itemId]
      return !cached || !areListingIdentitiesEqual(cached.identity, entry.listing)
    })
    if (pending.length === 0) return

    let cancelled = false
    const resolveAll = async () => {
      const resolvedEntries = await Promise.all(
        pending.map(async (entry) => ({
          itemId: entry.itemId,
          identity: entry.listing,
          resolved: await requestListingResolution(entry.listing).catch(() => null),
        }))
      )

      if (cancelled) return
      setResolvedByItemId((current) => {
        const next = { ...current }
        resolvedEntries.forEach((entry) => {
          next[entry.itemId] = {
            identity: entry.identity,
            resolved: entry.resolved,
          }
        })
        return next
      })
    }

    void resolveAll()

    return () => {
      cancelled = true
    }
  }, [listingRows, resolvedByItemId])

  useEffect(() => {
    if (!activeContainerId) return

    const exists =
      watchlist?.items.some((item) => item.type === 'section' && item.id === activeContainerId) ??
      false
    if (!exists) {
      setActiveContainerId(null)
    }
  }, [activeContainerId, watchlist])

  useEffect(() => {
    if (!selectedListingId) return

    const exists =
      watchlist?.items.some((item) => item.type === 'listing' && item.id === selectedListingId) ??
      false
    if (!exists) {
      setSelectedListingId(null)
    }
  }, [selectedListingId, watchlist])

  const resetListingEditor = useCallback(
    (itemId: string) => {
      resetListingSelectorInstance(buildListingEditorInstanceId(itemId))
    },
    [resetListingSelectorInstance]
  )

  const startListingEdit = (row: ListingRowEntry) => {
    if (isMutating) return
    const instanceId = buildListingEditorInstanceId(row.item.id)
    ensureListingSelectorInstance(instanceId, { providerId })
    updateListingSelectorInstance(instanceId, {
      providerId,
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingValue: row.item.listing,
      selectedListing: buildListingDisplayOption(
        row.listing,
        areListingIdentitiesEqual(resolvedByItemId[row.itemId]?.identity, row.listing)
          ? resolvedByItemId[row.itemId]?.resolved
          : null
      ),
    })
    setEditingListingId(row.item.id)
  }

  const cancelListingEdit = useCallback(
    (itemId: string) => {
      resetListingEditor(itemId)
      setEditingListingId((current) => (current === itemId ? null : current))
    },
    [resetListingEditor]
  )

  const commitListingSelection = async (itemId: string, listingOption: ListingOption | null) => {
    const listing = toListingValue(listingOption)
    if (!listing) return
    const previousListing = watchlist?.items.find(
      (item): item is WatchlistListingItem => item.type === 'listing' && item.id === itemId
    )?.listing
    const shouldSyncLinkedSelection =
      isLinkedSelection &&
      selectedListing &&
      previousListing &&
      areListingIdentitiesEqual(selectedListing, previousListing)

    const succeeded = await onUpdateItemListing(itemId, listing)
    if (!succeeded) return

    resetListingEditor(itemId)
    setEditingListingId((current) => (current === itemId ? null : current))
    if (shouldSyncLinkedSelection) {
      onSelectListing?.(listing)
    }
  }

  useEffect(() => {
    if (!editingListingId) return
    updateListingSelectorInstance(buildListingEditorInstanceId(editingListingId), { providerId })
  }, [editingListingId, providerId, updateListingSelectorInstance])

  useEffect(() => {
    if (!editingListingId) return
    if (watchlist?.items.some((item) => item.id === editingListingId)) return
    setEditingListingId(null)
  }, [editingListingId, watchlist])

  useEffect(() => {
    if (!editingListingId || isMutating) return

    const activeSurfaceId = buildListingEditSurfaceId(editingListingId)
    const activeSelectorId = buildListingEditorInstanceId(editingListingId)
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`[data-watchlist-listing-edit-surface="${activeSurfaceId}"]`)) return
      if (target.closest(`[data-market-selector-id="${activeSelectorId}"]`)) return
      cancelListingEdit(editingListingId)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [cancelListingEdit, editingListingId, isMutating])

  useEffect(() => {
    if (!editingContainerId) return
    containerRenameInputRef.current?.focus()
  }, [editingContainerId])

  const hasContainers = parsedRows.allContainers.length > 0
  const dragEnabled = !isMutating
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const sortableIds = useMemo(() => {
    const next: UniqueIdentifier[] = []

    if (hasContainers) {
      next.push(WATCHLIST_ROOT_SORTABLE_ID)
    }

    const appendBlockIds = (block: WatchlistTableBlock) => {
      if (block.type === 'listing') {
        next.push(createWatchlistListingSortableId(block.row.item.id))
        return
      }

      next.push(createWatchlistContainerSortableId(block.container.container.id))
      if (!(expandedContainers[block.container.container.id] ?? true)) return
      block.container.children.forEach((row) => {
        next.push(createWatchlistListingSortableId(row.item.id))
      })
    }

    parsedRows.rootBlocks.forEach(appendBlockIds)

    return next
  }, [expandedContainers, hasContainers, parsedRows])

  const commitDrop = async (activeSortableId: string, overSortableId: string) => {
    if (!watchlist || !dragEnabled) return

    const nextItems = moveWatchlistItem(watchlist.items, activeSortableId, overSortableId)
    if (!nextItems) return

    await onReorderItems(nextItems)
  }

  const handleMove = (activeId: UniqueIdentifier, overId: UniqueIdentifier | null) => {
    if (!dragEnabled || !overId) return
    void commitDrop(String(activeId), String(overId))
  }

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!dragEnabled || !watchlist || !over) {
      setDropTarget(null)
      return
    }

    setDropTarget(resolveEffectiveDropTarget(watchlist.items, String(active.id), String(over.id)))
  }

  const resetDragState = () => {
    setDropTarget(null)
  }

  const cancelContainerRename = () => {
    setEditingContainerId(null)
    setEditingContainerLabel('')
  }

  const startContainerRename = (container: WatchlistContainerItem) => {
    if (isMutating) return
    setEditingContainerId(container.id)
    setEditingContainerLabel(container.label)
    setActiveContainerId(container.id)
  }

  const commitContainerRename = async (container: WatchlistContainerItem) => {
    const nextLabel = editingContainerLabel.trim()
    if (!nextLabel || nextLabel === container.label) {
      cancelContainerRename()
      return
    }

    try {
      await onRenameContainer(container.id, nextLabel)
      cancelContainerRename()
    } catch {
      // Keep edit mode active so the user can retry.
    }
  }

  const handleContainerRenameKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    container: WatchlistContainerItem
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitContainerRename(container)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelContainerRename()
    }
  }

  const handleConfirmContainerDelete = async () => {
    if (!containerToDelete) return

    try {
      await onRemoveContainer(containerToDelete.id)
      setContainerToDelete(null)
    } catch {
      // Keep the dialog open so the user can retry or cancel.
    }
  }

  const handleConfirmItemDelete = async () => {
    if (!listingToDelete) return

    try {
      await onRemoveItem(listingToDelete.id)
      setListingToDelete(null)
    } catch {
      // Keep the dialog open so the user can retry or cancel.
    }
  }

  const handleToggleListingSelection = (row: ListingRowEntry) => {
    if (isLinkedSelection) {
      const nextListing =
        selectedListing && areListingIdentitiesEqual(selectedListing, row.listing)
          ? null
          : row.listing
      onSelectListing?.(nextListing)
      return
    }

    setSelectedListingId((current) => (current === row.item.id ? null : row.item.id))
  }

  if (!watchlist || listingRows.length + parsedRows.allContainers.length === 0) {
    return (
      <div className='flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background'>
        <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm'>
          {copy.noItemsInThisWatchlist}
        </div>
      </div>
    )
  }

  const renderListingEditor = (itemId: string) => {
    const instanceId = buildListingEditorInstanceId(itemId)

    return (
      <div className='relative z-20 flex items-center bg-background'>
        <ListingSearchInput
          instanceId={instanceId}
          variant='header'
          providerType='market'
          disabled={isMutating}
          activateOnMount
          className='min-w-0 flex-1 [&>div>button]:h-6 [&>div>button]:w-6 [&>div>input]:h-9 [&>div>input]:rounded-sm [&>div>input]:pr-9 [&>div>input]:text-xs'
          onListingChange={(listing) => {
            void commitListingSelection(itemId, listing)
          }}
        />
      </div>
    )
  }

  const renderListingRow = (row: ListingRowEntry) => {
    const quote = quotes[row.itemId]
    const resolved =
      resolvedByItemId[row.itemId] &&
      areListingIdentitiesEqual(resolvedByItemId[row.itemId]?.identity, row.listing)
        ? resolvedByItemId[row.itemId]?.resolved
        : null
    const listing = buildListingDisplayOption(row.listing, resolved)
    const listingLabel = listing.quote?.trim()
      ? `${getListingPrimary(listing)}/${listing.quote.trim()}`
      : getListingPrimary(listing)
    const assetClass = resolveWatchlistAssetClass(row.listing, resolved)
    const isDropBefore = dropTarget?.type === 'before' && dropTarget.itemId === row.item.id
    const sortableId = createWatchlistListingSortableId(row.item.id)
    const isEditing = editingListingId === row.item.id
    const isSelected = isLinkedSelection
      ? areListingIdentitiesEqual(selectedListing, row.listing)
      : selectedListingId === row.item.id
    const editSurfaceId = isEditing ? buildListingEditSurfaceId(row.item.id) : undefined

    return (
      <SortableItem
        key={row.item.id}
        value={sortableId}
        asHandle
        asChild
        disabled={!dragEnabled || isEditing}
      >
        <tr
          data-watchlist-listing-edit-surface={editSurfaceId}
          className={cn(
            'group/listing border-b bg-background transition-colors',
            isEditing && 'relative z-20',
            isDropBefore ? 'bg-primary/10' : isSelected ? 'bg-accent' : 'hover:bg-accent/20'
          )}
          onClick={() => {
            if (isEditing || (isMutating && !isLinkedSelection)) return
            handleToggleListingSelection(row)
          }}
        >
          <td className={cn('p-3 align-middle', isEditing && 'relative z-20 overflow-visible')}>
            {isEditing ? (
              renderListingEditor(row.item.id)
            ) : (
              <div
                className='flex items-center'
                style={row.isSectionChild ? { paddingLeft: 16 } : undefined}
              >
                <MarketListingRow listing={listing} className='w-full pl-1' />
              </div>
            )}
          </td>
          <td className='p-3 text-center align-middle'>
            <span className='text-sm'>{assetClass}</span>
          </td>
          <td className='p-3 text-center align-middle'>
            <span className='text-sm'>{formatPrice(quote?.lastPrice ?? null, locale)}</span>
          </td>
          <td className='p-3 text-center align-middle'>
            <span className={cn('text-sm', resolveWatchlistValueColorClass(quote?.change ?? null))}>
              {formatPrice(quote?.change ?? null, locale)}
            </span>
          </td>
          <td className='p-3 text-center align-middle'>
            <span
              className={cn(
                'text-sm',
                resolveWatchlistValueColorClass(quote?.changePercent ?? null)
              )}
            >
              {formatPercent(quote?.changePercent ?? null, locale)}
            </span>
          </td>
          <td className='p-3 text-center align-middle'>
            <div className='flex items-center justify-center gap-1'>
              <div
                className={cn(
                  'flex items-center justify-center gap-1',
                  isEditing
                    ? 'pointer-events-auto opacity-100'
                    : 'pointer-events-none opacity-0 transition-opacity group-focus-within/listing:pointer-events-auto group-focus-within/listing:opacity-100 group-hover/listing:pointer-events-auto group-hover/listing:opacity-100'
                )}
              >
                {isEditing ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                    onPointerDownCapture={stopSortableActivation}
                    onMouseDown={stopSortableActivation}
                    onTouchStart={stopSortableActivation}
                    onClick={(event) => {
                      event.stopPropagation()
                      cancelListingEdit(row.item.id)
                    }}
                    disabled={isMutating}
                  >
                    <X className='!h-3.5 !w-3.5' />
                    <span className='sr-only'>{copy.cancelSymbolEdit}</span>
                  </Button>
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                    onPointerDownCapture={stopSortableActivation}
                    onMouseDown={stopSortableActivation}
                    onTouchStart={stopSortableActivation}
                    onClick={(event) => {
                      event.stopPropagation()
                      startListingEdit(row)
                    }}
                    disabled={isMutating}
                  >
                    <Pencil className='!h-3.5 !w-3.5' />
                    <span className='sr-only'>{copy.editSymbol}</span>
                  </Button>
                )}
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                  onPointerDownCapture={stopSortableActivation}
                  onMouseDown={stopSortableActivation}
                  onTouchStart={stopSortableActivation}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (isEditing) {
                      cancelListingEdit(row.item.id)
                    }
                    setListingToDelete({ id: row.item.id, label: listingLabel })
                  }}
                  disabled={isMutating}
                >
                  <Trash2 className='!h-3.5 !w-3.5' />
                  <span className='sr-only'>{copy.removeSymbol}</span>
                </Button>
              </div>
            </div>
          </td>
        </tr>
      </SortableItem>
    )
  }

  const renderBlock = (block: WatchlistTableBlock) =>
    block.type === 'listing' ? renderListingRow(block.row) : renderContainerBlock(block.container)

  const renderContainerBlock = (container: ContainerBlock) => {
    const isExpanded = expandedContainers[container.container.id] ?? true
    const isDropContainer =
      dropTarget?.type === 'container' && dropTarget.containerId === container.container.id
    const containerSortableId = createWatchlistContainerSortableId(container.container.id)
    const isEditingContainer = editingContainerId === container.container.id
    const isSelected = activeContainerId === container.container.id

    return (
      <Fragment key={container.container.id}>
        <SortableItem value={containerSortableId} asHandle asChild disabled={!dragEnabled}>
          <tr
            className={cn(
              'group/section border-b bg-card transition-colors',
              isDropContainer ? 'bg-primary/10' : isSelected ? 'bg-accent' : 'hover:bg-accent/20'
            )}
            onClick={() => setActiveContainerId(container.container.id)}
          >
            <td colSpan={COLUMN_COUNT} className='p-0'>
              <div className='flex items-center gap-2 px-3 py-2'>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                  onPointerDownCapture={stopSortableActivation}
                  onMouseDown={stopSortableActivation}
                  onTouchStart={stopSortableActivation}
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpandedContainers((current) => ({
                      ...current,
                      [container.container.id]: !(current[container.container.id] ?? true),
                    }))
                  }}
                >
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                  />
                  <span className='sr-only'>
                    {isExpanded ? copy.collapseSection : copy.expandSection}
                  </span>
                </Button>

                {isEditingContainer ? (
                  <input
                    ref={containerRenameInputRef}
                    value={editingContainerLabel}
                    onChange={(event) => setEditingContainerLabel(event.target.value)}
                    onKeyDown={(event) => handleContainerRenameKeyDown(event, container.container)}
                    onBlur={() => {
                      void commitContainerRename(container.container)
                    }}
                    onPointerDownCapture={stopSortableActivation}
                    onMouseDown={stopSortableActivation}
                    onTouchStart={stopSortableActivation}
                    onClick={(event) => event.stopPropagation()}
                    className='min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-foreground text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                    maxLength={100}
                    disabled={isMutating}
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    spellCheck='false'
                  />
                ) : (
                  <span className='min-w-0 flex-1 truncate pr-1 font-medium text-foreground text-sm'>
                    {container.container.label}
                  </span>
                )}

                <div
                  className={cn(
                    'flex items-center justify-center gap-1',
                    isEditingContainer
                      ? 'pointer-events-auto opacity-100'
                      : 'pointer-events-none opacity-0 transition-opacity group-focus-within/section:pointer-events-auto group-focus-within/section:opacity-100 group-hover/section:pointer-events-auto group-hover/section:opacity-100'
                  )}
                >
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                    onPointerDownCapture={stopSortableActivation}
                    onMouseDown={stopSortableActivation}
                    onTouchStart={stopSortableActivation}
                    onClick={(event) => {
                      event.stopPropagation()
                      startContainerRename(container.container)
                    }}
                    disabled={isMutating || isEditingContainer}
                  >
                    <Pencil className='!h-3.5 !w-3.5' />
                    <span className='sr-only'>{copy.renameSection}</span>
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                    onPointerDownCapture={stopSortableActivation}
                    onMouseDown={stopSortableActivation}
                    onTouchStart={stopSortableActivation}
                    onClick={(event) => {
                      event.stopPropagation()
                      setContainerToDelete(container.container)
                    }}
                    disabled={isMutating}
                  >
                    <Trash2 className='!h-3.5 !w-3.5' />
                    <span className='sr-only'>{copy.deleteSection}</span>
                  </Button>
                </div>
              </div>
            </td>
          </tr>
        </SortableItem>

        {isExpanded ? <>{container.children.map(renderListingRow)}</> : null}
      </Fragment>
    )
  }

  return (
    <div className='flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background'>
      <div className='h-full max-h-full min-h-0 overflow-auto'>
        <Sortable
          orientation='vertical'
          value={sortableIds}
          sensors={sensors}
          flatCursor
          onDragOver={handleDragOver}
          onDragCancel={resetDragState}
          onDragEnd={resetDragState}
          onMove={({ active, over }) => {
            handleMove(active.id, over?.id ?? null)
          }}
        >
          <table className='w-full table-auto'>
            <thead className='sticky top-0 z-10 border-b bg-card'>
              <tr>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>{copy.symbol}</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>{copy.asset}</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>{copy.last}</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>{copy.change}</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>
                    {copy.changePercent}
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>{copy.actions}</span>
                </th>
              </tr>
            </thead>
            <SortableContent withoutSlot>
              <tbody>
                {hasContainers ? (
                  <SortableItem value={WATCHLIST_ROOT_SORTABLE_ID} asChild>
                    <tr>
                      <td colSpan={COLUMN_COUNT} className='p-0'>
                        <div
                          className={cn(
                            'h-2 transition-colors',
                            dropTarget?.type === 'root'
                              ? 'bg-primary/15 ring-1 ring-primary/30 ring-inset'
                              : 'bg-transparent'
                          )}
                        />
                      </td>
                    </tr>
                  </SortableItem>
                ) : null}

                {parsedRows.rootBlocks.map((block) => renderBlock(block))}
              </tbody>
            </SortableContent>
          </table>
        </Sortable>
      </div>

      <AlertDialog
        open={Boolean(listingToDelete)}
        onOpenChange={(open) => !open && setListingToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteSymbolDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {listingToDelete
                ? formatTemplate(copy.deleteSymbolDialogDescription, {
                    name: listingToDelete.label,
                  })
                : copy.deleteSymbolDialogDescriptionFallback}{' '}
              <span className='text-red-500 dark:text-red-500'>
                {copy.deleteSymbolDialogDescriptionHighlight}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isMutating}>
              {copy.cancel}
            </AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmItemDelete()
              }}
              disabled={isMutating}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              {isMutating ? copy.deleting : copy.delete}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(containerToDelete)}
        onOpenChange={(open) => !open && setContainerToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteSectionDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.deleteSectionDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmContainerDelete()
              }}
            >
              {copy.sectionDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
