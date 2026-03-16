'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from 'react'
import type { DragOverEvent, UniqueIdentifier } from '@dnd-kit/core'
import { ChevronRight, Pencil, Trash2, X } from 'lucide-react'
import { getListingPrimary, MarketListingRow } from '@/components/listing-selector/listing/row'
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
  toListingValue,
  type ListingIdentity,
  type ListingOption,
} from '@/lib/listing/identity'
import type {
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
} from '@/lib/watchlists/types'
import { cn } from '@/lib/utils'
import type { WatchlistQuoteSnapshot } from '@/hooks/queries/watchlist-quotes'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import {
  createWatchlistListingSortableId,
  createWatchlistSectionSortableId,
  moveWatchlistItem,
  resolveEffectiveDropTarget,
  type WatchlistDropTarget,
  WATCHLIST_ROOT_SORTABLE_ID,
} from '@/widgets/widgets/watchlist/components/watchlist-reorder'
import {
  resolveWatchlistAssetClass,
  resolveWatchlistValueColorClass,
} from '@/widgets/widgets/watchlist/components/watchlist-table-utils'
import { StockSelector } from '@/widgets/widgets/watchlist/components/stock-selector'

type WatchlistTableProps = {
  watchlist: WatchlistRecord | null
  quotes: Record<string, WatchlistQuoteSnapshot>
  providerId?: string
  draftRows: WatchlistDraftListingRow[]
  onCreateDraftRowListing: (draftId: string, listing: ListingIdentity) => Promise<boolean> | boolean
  onCancelDraftRow: (draftId: string) => void
  onUpdateItemListing: (itemId: string, listing: ListingIdentity) => Promise<boolean> | boolean
  onReorderItems: (orderedItemIds: string[]) => Promise<void>
  onRemoveItem: (itemId: string) => Promise<void> | void
  onRenameSection: (sectionId: string, label: string) => Promise<void> | void
  onRemoveSection: (sectionId: string) => Promise<void> | void
  isMutating?: boolean
}

export type WatchlistDraftListingRow = {
  id: string
}

type ListingRowEntry = {
  item: WatchlistListingItem
  listing: ListingIdentity
  itemId: string
}

type SectionBlock = {
  section: WatchlistSectionItem
  rows: ListingRowEntry[]
}

type EditingListingTarget =
  | { kind: 'draft'; id: string }
  | { kind: 'listing'; id: string }
  | null

type ResolvedListingEntry = {
  identity: ListingIdentity
  resolved: ListingOption | null
}

type ListingToDelete = {
  id: string
  label: string
}

const percentFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

const COLUMN_COUNT = 6

const formatPrice = (value: number | null) => (value == null ? '-' : priceFormatter.format(value))
const formatPercent = (value: number | null) =>
  value == null ? '-' : `${percentFormatter.format(value)}%`

const buildListingOption = (
  listing: ListingIdentity,
  resolved?: ListingOption | null
): ListingOption => ({
  ...listing,
  ...resolved,
  base:
    resolved?.base?.trim() ||
    (listing.listing_type === 'default' ? listing.listing_id : listing.base_id),
  quote:
    resolved?.quote?.trim() ||
    (listing.listing_type === 'default' ? null : listing.quote_id),
  name:
    resolved?.name?.trim() ||
    (listing.listing_type === 'default'
      ? listing.listing_id
      : `${listing.base_id}/${listing.quote_id}`),
})

const stopSortableActivation = (
  event:
    | ReactMouseEvent<HTMLElement>
    | ReactPointerEvent<HTMLElement>
    | ReactTouchEvent<HTMLElement>
) => {
  event.stopPropagation()
}

const buildListingEditorInstanceId = (target: Exclude<EditingListingTarget, null>) =>
  `watchlist-listing-editor-${target.kind}-${target.id}`

const buildListingEditSurfaceId = (target: Exclude<EditingListingTarget, null>) =>
  `watchlist-listing-edit-surface-${target.kind}-${target.id}`

export const WatchlistTable = ({
  watchlist,
  quotes,
  providerId,
  draftRows,
  onCreateDraftRowListing,
  onCancelDraftRow,
  onUpdateItemListing,
  onReorderItems,
  onRemoveItem,
  onRenameSection,
  onRemoveSection,
  isMutating = false,
}: WatchlistTableProps) => {
  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)
  const resetListingSelectorInstance = useListingSelectorStore((state) => state.resetInstance)
  const [resolvedByItemId, setResolvedByItemId] = useState<Record<string, ResolvedListingEntry>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [dropTarget, setDropTarget] = useState<WatchlistDropTarget | null>(null)
  const [listingToDelete, setListingToDelete] = useState<ListingToDelete | null>(null)
  const [sectionToDelete, setSectionToDelete] = useState<WatchlistSectionItem | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingSectionLabel, setEditingSectionLabel] = useState('')
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [editingListingTarget, setEditingListingTarget] = useState<EditingListingTarget>(null)
  const previousDraftIdsRef = useRef<string[]>([])

  const parsedRows = useMemo(() => {
    const unsectionedRows: ListingRowEntry[] = []
    const sections: SectionBlock[] = []
    let activeSection: SectionBlock | null = null

    for (const item of watchlist?.items ?? []) {
      if (item.type === 'section') {
        const sectionBlock = { section: item, rows: [] as ListingRowEntry[] }
        sections.push(sectionBlock)
        activeSection = sectionBlock
        continue
      }

      const row: ListingRowEntry = {
        item,
        listing: item.listing,
        itemId: item.id,
      }

      if (activeSection) {
        activeSection.rows.push(row)
      } else {
        unsectionedRows.push(row)
      }
    }

    return { unsectionedRows, sections }
  }, [watchlist])

  const listingRows = useMemo(
    () => [
      ...parsedRows.unsectionedRows,
      ...parsedRows.sections.flatMap((section) => section.rows),
    ],
    [parsedRows]
  )

  useEffect(() => {
    setExpandedSections((current) => {
      const next: Record<string, boolean> = {}
      parsedRows.sections.forEach((section) => {
        next[section.section.id] = current[section.section.id] ?? true
      })
      return next
    })
  }, [parsedRows.sections])

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
    if (!activeRowId) return

    const [, itemId] = activeRowId.split(':')
    const exists =
      (watchlist?.items.some((item) => item.id === itemId) ?? false) ||
      draftRows.some((draft) => draft.id === itemId)
    if (!exists) {
      setActiveRowId(null)
    }
  }, [activeRowId, draftRows, watchlist])

  const resetListingEditor = useCallback((target: Exclude<EditingListingTarget, null>) => {
    resetListingSelectorInstance(buildListingEditorInstanceId(target))
  }, [resetListingSelectorInstance])

  const startDraftRowEdit = (draftId: string) => {
    const target: Exclude<EditingListingTarget, null> = { kind: 'draft', id: draftId }
    const instanceId = buildListingEditorInstanceId(target)
    ensureListingSelectorInstance(instanceId, { providerId })
    updateListingSelectorInstance(instanceId, {
      providerId,
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingValue: null,
      selectedListing: null,
    })
    setEditingListingTarget(target)
    setActiveRowId(`draft:${draftId}`)
  }

  const startListingEdit = (row: ListingRowEntry) => {
    if (isMutating) return
    const target: Exclude<EditingListingTarget, null> = { kind: 'listing', id: row.item.id }
    const instanceId = buildListingEditorInstanceId(target)
    ensureListingSelectorInstance(instanceId, { providerId })
    updateListingSelectorInstance(instanceId, {
      providerId,
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingValue: row.item.listing,
      selectedListing: buildListingOption(
        row.listing,
        areListingIdentitiesEqual(resolvedByItemId[row.itemId]?.identity, row.listing)
          ? resolvedByItemId[row.itemId]?.resolved
          : null
      ),
    })
    setEditingListingTarget(target)
    setActiveRowId(`listing:${row.item.id}`)
  }

  const cancelListingEdit = useCallback((target: Exclude<EditingListingTarget, null>) => {
    resetListingEditor(target)
    setEditingListingTarget((current) =>
      current?.kind === target.kind && current.id === target.id ? null : current
    )
    if (target.kind === 'draft') {
      onCancelDraftRow(target.id)
    }
  }, [onCancelDraftRow, resetListingEditor])

  const commitListingSelection = async (
    target: Exclude<EditingListingTarget, null>,
    listingOption: ListingOption | null
  ) => {
    const listing = toListingValue(listingOption)
    if (!listing) return

    const succeeded =
      target.kind === 'draft'
        ? await onCreateDraftRowListing(target.id, listing)
        : await onUpdateItemListing(target.id, listing)
    if (!succeeded) return

    resetListingEditor(target)
    setEditingListingTarget((current) =>
      current?.kind === target.kind && current.id === target.id ? null : current
    )
  }

  useEffect(() => {
    if (!editingListingTarget) return
    updateListingSelectorInstance(buildListingEditorInstanceId(editingListingTarget), { providerId })
  }, [editingListingTarget, providerId, updateListingSelectorInstance])

  useEffect(() => {
    const previousDraftIds = previousDraftIdsRef.current
    const nextDraftIds = draftRows.map((draft) => draft.id)
    const newlyAddedDraftId = nextDraftIds.find((id) => !previousDraftIds.includes(id))
    previousDraftIdsRef.current = nextDraftIds

    if (!newlyAddedDraftId) return
    startDraftRowEdit(newlyAddedDraftId)
  }, [draftRows, providerId])

  useEffect(() => {
    if (!editingListingTarget) return

    if (editingListingTarget.kind === 'draft') {
      if (draftRows.some((draft) => draft.id === editingListingTarget.id)) return
      setEditingListingTarget(null)
      return
    }

    if (watchlist?.items.some((item) => item.id === editingListingTarget.id)) return
    setEditingListingTarget(null)
  }, [draftRows, editingListingTarget, watchlist])

  useEffect(() => {
    if (!editingListingTarget || isMutating) return

    const activeSurfaceId = buildListingEditSurfaceId(editingListingTarget)
    const activeSelectorId = buildListingEditorInstanceId(editingListingTarget)
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`[data-watchlist-listing-edit-surface="${activeSurfaceId}"]`)) return
      if (target.closest(`[data-market-selector-id="${activeSelectorId}"]`)) return
      cancelListingEdit(editingListingTarget)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [cancelListingEdit, editingListingTarget, isMutating])

  const hasAnyItem = (watchlist?.items.length ?? 0) + draftRows.length > 0
  const hasSections = parsedRows.sections.length > 0
  const dragEnabled = !isMutating
  const sortableIds = useMemo(() => {
    const next: UniqueIdentifier[] = []

    if (hasSections) {
      next.push(WATCHLIST_ROOT_SORTABLE_ID)
    }

    parsedRows.unsectionedRows.forEach((row) => {
      next.push(createWatchlistListingSortableId(row.item.id))
    })

    parsedRows.sections.forEach((section) => {
      next.push(createWatchlistSectionSortableId(section.section.id))
      if (!(expandedSections[section.section.id] ?? true)) return

      section.rows.forEach((row) => {
        next.push(createWatchlistListingSortableId(row.item.id))
      })
    })

    return next
  }, [expandedSections, hasSections, parsedRows])

  const commitDrop = async (activeSortableId: string, overSortableId: string) => {
    if (!watchlist || !dragEnabled) return

    const nextItems = moveWatchlistItem(watchlist.items, activeSortableId, overSortableId)
    if (!nextItems) return

    await onReorderItems(nextItems.map((item) => item.id))
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

  const cancelSectionRename = () => {
    setEditingSectionId(null)
    setEditingSectionLabel('')
  }

  const startSectionRename = (section: WatchlistSectionItem) => {
    if (isMutating) return
    setEditingSectionId(section.id)
    setEditingSectionLabel(section.label)
    setActiveRowId(`section:${section.id}`)
  }

  const commitSectionRename = async (section: WatchlistSectionItem) => {
    const nextLabel = editingSectionLabel.trim()
    if (!nextLabel || nextLabel === section.label) {
      cancelSectionRename()
      return
    }

    try {
      await onRenameSection(section.id, nextLabel)
      cancelSectionRename()
    } catch {
      // Keep edit mode active so the user can retry.
    }
  }

  const handleSectionRenameKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    section: WatchlistSectionItem
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitSectionRename(section)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelSectionRename()
    }
  }

  const handleConfirmSectionDelete = async () => {
    if (!sectionToDelete) return

    try {
      await onRemoveSection(sectionToDelete.id)
      setSectionToDelete(null)
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

  if (!watchlist || !hasAnyItem) {
    return (
      <div className='flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background'>
        <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm'>
          No items in this watchlist.
        </div>
      </div>
    )
  }

  const renderListingEditor = (
    target: Exclude<EditingListingTarget, null>,
    nested = false
  ) => {
    const instanceId = buildListingEditorInstanceId(target)

    return (
      <div className={cn('relative z-20 flex items-center bg-background', nested && 'pl-6')}>
        <StockSelector
          instanceId={instanceId}
          providerType='market'
          disabled={isMutating}
          activateOnMount={target.kind === 'listing'}
          className='min-w-0 flex-1 [&>div>button]:h-6 [&>div>button]:w-6 [&>div>input]:h-9 [&>div>input]:rounded-sm [&>div>input]:pr-9 [&>div>input]:text-xs'
          onListingChange={(listing) => {
            void commitListingSelection(target, listing)
          }}
        />
      </div>
    )
  }

  const renderListingRow = (row: ListingRowEntry, nested = false) => {
    const quote = quotes[row.itemId]
    const resolved =
      resolvedByItemId[row.itemId] &&
      areListingIdentitiesEqual(resolvedByItemId[row.itemId]?.identity, row.listing)
        ? resolvedByItemId[row.itemId]?.resolved
        : null
    const listing = buildListingOption(row.listing, resolved)
    const listingLabel = listing.quote?.trim()
      ? `${getListingPrimary(listing)}/${listing.quote.trim()}`
      : getListingPrimary(listing)
    const assetClass = resolveWatchlistAssetClass(row.listing, resolved)
    const isDropBefore = dropTarget?.type === 'before' && dropTarget.itemId === row.item.id
    const sortableId = createWatchlistListingSortableId(row.item.id)
    const isSelected = activeRowId === `listing:${row.item.id}`
    const isEditing =
      editingListingTarget?.kind === 'listing' && editingListingTarget.id === row.item.id
    const editingTarget = isEditing ? editingListingTarget : null
    const editSurfaceId = editingTarget ? buildListingEditSurfaceId(editingTarget) : undefined

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
            isDropBefore
              ? 'bg-primary/10'
              : isSelected
                ? 'bg-accent'
                : 'hover:bg-accent/20'
          )}
          onClick={() => setActiveRowId(`listing:${row.item.id}`)}
        >
          <td className={cn('p-3 align-middle', isEditing && 'relative z-20 overflow-visible')}>
            {editingTarget ? (
              renderListingEditor(editingTarget, nested)
            ) : (
              <div className={cn('flex items-center', nested && 'pl-6')}>
                <MarketListingRow listing={listing} className='w-full pl-1' />
              </div>
            )}
          </td>
          <td className='p-3 text-center align-middle'>
            <span className='text-sm'>{assetClass}</span>
          </td>
          <td className='p-3 text-center align-middle'>
            <span className='text-sm'>{formatPrice(quote?.lastPrice ?? null)}</span>
          </td>
          <td className='p-3 text-center align-middle'>
            <span className={cn('text-sm', resolveWatchlistValueColorClass(quote?.change ?? null))}>
              {formatPrice(quote?.change ?? null)}
            </span>
          </td>
          <td className='p-3 text-center align-middle'>
            <span
              className={cn('text-sm', resolveWatchlistValueColorClass(quote?.changePercent ?? null))}
            >
              {formatPercent(quote?.changePercent ?? null)}
            </span>
          </td>
          <td className='p-3 text-center align-middle'>
            <div
              className={cn(
                'flex items-center justify-center gap-1',
                isEditing
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0 transition-opacity group-hover/listing:pointer-events-auto group-hover/listing:opacity-100 group-focus-within/listing:pointer-events-auto group-focus-within/listing:opacity-100'
              )}
            >
              {editingTarget ? (
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
                    cancelListingEdit(editingTarget)
                  }}
                  disabled={isMutating}
                >
                  <X className='!h-3.5 !w-3.5' />
                  <span className='sr-only'>Cancel symbol edit</span>
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
                  <span className='sr-only'>Edit symbol</span>
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
                  if (editingTarget) {
                    cancelListingEdit(editingTarget)
                  }
                  setListingToDelete({ id: row.item.id, label: listingLabel })
                }}
                disabled={isMutating}
              >
                <Trash2 className='!h-3.5 !w-3.5' />
                <span className='sr-only'>Remove symbol</span>
              </Button>
            </div>
          </td>
        </tr>
      </SortableItem>
    )
  }

  const renderDraftRow = (draftRow: WatchlistDraftListingRow) => {
    const isSelected = activeRowId === `draft:${draftRow.id}`
    const isEditing =
      editingListingTarget?.kind === 'draft' && editingListingTarget.id === draftRow.id
    const editingTarget = isEditing ? editingListingTarget : null
    const editSurfaceId = editingTarget ? buildListingEditSurfaceId(editingTarget) : undefined

    return (
      <tr
        key={draftRow.id}
        data-watchlist-listing-edit-surface={editSurfaceId}
        className={cn(
          'group/listing border-b bg-background transition-colors',
          isEditing && 'relative z-20',
          isSelected ? 'bg-accent' : 'hover:bg-accent/20'
        )}
        onClick={() => {
          setActiveRowId(`draft:${draftRow.id}`)
          if (!editingTarget) {
            startDraftRowEdit(draftRow.id)
          }
        }}
      >
        <td className={cn('p-3 align-middle', isEditing && 'relative z-20 overflow-visible')}>
          {editingTarget ? (
            renderListingEditor(editingTarget)
          ) : (
            <span className='pl-1 text-muted-foreground text-sm'>Select listing</span>
          )}
        </td>
        <td className='p-3 text-center align-middle'>
          <span className='text-muted-foreground text-sm'>-</span>
        </td>
        <td className='p-3 text-center align-middle'>
          <span className='text-muted-foreground text-sm'>-</span>
        </td>
        <td className='p-3 text-center align-middle'>
          <span className='text-muted-foreground text-sm'>-</span>
        </td>
        <td className='p-3 text-center align-middle'>
          <span className='text-muted-foreground text-sm'>-</span>
        </td>
        <td className='p-3 text-center align-middle'>
          <div className='flex items-center justify-center gap-1 opacity-100'>
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
                cancelListingEdit({ kind: 'draft', id: draftRow.id })
              }}
              disabled={isMutating}
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Remove draft symbol</span>
            </Button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className='flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background'>
      <div className='h-full max-h-full min-h-0 overflow-auto'>
        <Sortable
          orientation='vertical'
          value={sortableIds}
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
                  <span className='text-muted-foreground text-xs leading-none'>Symbol</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Asset</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Last</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Change</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Change %</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Actions</span>
                </th>
              </tr>
            </thead>
            <SortableContent withoutSlot>
              <tbody>
                {hasSections ? (
                  <SortableItem value={WATCHLIST_ROOT_SORTABLE_ID} asChild>
                    <tr>
                      <td colSpan={COLUMN_COUNT} className='p-0'>
                        <div
                          className={cn(
                            'h-2 transition-colors',
                            dropTarget?.type === 'root'
                              ? 'bg-primary/15 ring-1 ring-inset ring-primary/30'
                              : 'bg-transparent'
                          )}
                        />
                      </td>
                    </tr>
                  </SortableItem>
                ) : null}

                {parsedRows.unsectionedRows.map((row) => renderListingRow(row))}
                {draftRows.map((draftRow) => renderDraftRow(draftRow))}

                {parsedRows.sections.map((section) => {
                  const isExpanded = expandedSections[section.section.id] ?? true
                  const isDropSection =
                    dropTarget?.type === 'section' && dropTarget.sectionId === section.section.id
                  const sectionSortableId = createWatchlistSectionSortableId(section.section.id)
                  const isEditingSection = editingSectionId === section.section.id
                  const isSelected = activeRowId === `section:${section.section.id}`

                  return (
                    <Fragment key={section.section.id}>
                      <SortableItem
                        value={sectionSortableId}
                        asHandle
                        asChild
                        disabled={!dragEnabled}
                      >
                        <tr
                          className={cn(
                            'group/section border-b bg-card transition-colors',
                            isDropSection
                              ? 'bg-primary/10'
                              : isSelected
                                ? 'bg-accent'
                                : 'hover:bg-accent/20'
                          )}
                          onClick={() => setActiveRowId(`section:${section.section.id}`)}
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
                                  setExpandedSections((current) => ({
                                    ...current,
                                    [section.section.id]: !(current[section.section.id] ?? true),
                                  }))
                                }}
                              >
                                <ChevronRight
                                  className={cn(
                                    'h-3.5 w-3.5 transition-transform',
                                    isExpanded && 'rotate-90'
                                  )}
                                />
                                <span className='sr-only'>
                                  {isExpanded ? 'Collapse section' : 'Expand section'}
                                </span>
                              </Button>

                              {isEditingSection ? (
                                <input
                                  value={editingSectionLabel}
                                  onChange={(event) => setEditingSectionLabel(event.target.value)}
                                  onKeyDown={(event) =>
                                    handleSectionRenameKeyDown(event, section.section)
                                  }
                                  onBlur={() => {
                                    void commitSectionRename(section.section)
                                  }}
                                  onPointerDownCapture={stopSortableActivation}
                                  onMouseDown={stopSortableActivation}
                                  onTouchStart={stopSortableActivation}
                                  onClick={(event) => event.stopPropagation()}
                                  className='min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                                  maxLength={100}
                                  disabled={isMutating}
                                  autoFocus
                                  autoComplete='off'
                                  autoCorrect='off'
                                  autoCapitalize='off'
                                  spellCheck='false'
                                />
                              ) : (
                                <span className='min-w-0 flex-1 truncate pr-1 text-sm font-medium text-foreground'>
                                  {section.section.label}
                                </span>
                              )}

                              <div
                                className={cn(
                                  'flex items-center justify-center gap-1',
                                  isEditingSection
                                    ? 'pointer-events-auto opacity-100'
                                    : 'pointer-events-none opacity-0 transition-opacity group-hover/section:pointer-events-auto group-hover/section:opacity-100 group-focus-within/section:pointer-events-auto group-focus-within/section:opacity-100'
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
                                    startSectionRename(section.section)
                                  }}
                                  disabled={isMutating || isEditingSection}
                                >
                                  <Pencil className='!h-3.5 !w-3.5' />
                                  <span className='sr-only'>Rename section</span>
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
                                    setSectionToDelete(section.section)
                                  }}
                                  disabled={isMutating}
                                >
                                  <Trash2 className='!h-3.5 !w-3.5' />
                                  <span className='sr-only'>Delete section</span>
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </SortableItem>

                      {isExpanded ? section.rows.map((row) => renderListingRow(row, true)) : null}
                    </Fragment>
                  )
                })}
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
            <AlertDialogTitle>Delete symbol?</AlertDialogTitle>
            <AlertDialogDescription>
              Removing {listingToDelete?.label ?? 'this symbol'} will delete it from the watchlist.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isMutating}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmItemDelete()
              }}
              disabled={isMutating}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              {isMutating ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(sectionToDelete)}
        onOpenChange={(open) => !open && setSectionToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will also remove all symbols inside the section.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmSectionDelete()
              }}
            >
              Delete section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
