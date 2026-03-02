'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { DragOverEvent, UniqueIdentifier } from '@dnd-kit/core'
import { ChevronRight, GripVertical, Trash2, X } from 'lucide-react'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from '@/components/ui/sortable'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ListingIdentity, ListingOption } from '@/lib/listing/identity'
import { resolveListingKey } from '@/lib/listing/identity'
import type {
  WatchlistColumnKey,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
  WatchlistSort,
} from '@/lib/watchlists/types'
import type { WatchlistQuoteSnapshot } from '@/hooks/queries/watchlist-quotes'
import { getFlagData } from '@/widgets/widgets/data_chart/utils/listing-utils'
import {
  createWatchlistListingSortableId,
  createWatchlistSectionSortableId,
  moveWatchlistListingItem,
  resolveDraggedListingId,
  resolveDropTarget,
  type WatchlistDropTarget,
  WATCHLIST_UNSECTIONED_SORTABLE_ID,
} from '@/widgets/widgets/watchlist/components/watchlist-reorder'
import {
  resolveWatchlistAssetClass,
  resolveWatchlistListingLabel,
  resolveWatchlistValueColorClass,
  sortWatchlistRowsByColumn,
} from '@/widgets/widgets/watchlist/components/watchlist-table-utils'

type WatchlistTableProps = {
  watchlist: WatchlistRecord | null
  quotes: Record<string, WatchlistQuoteSnapshot>
  sort: WatchlistSort | null
  onSortChange: (next: WatchlistSort | null) => void
  onReorderItems: (orderedItemIds: string[]) => Promise<void>
  onRemoveItem: (itemId: string) => Promise<void> | void
  onRemoveSection: (sectionId: string) => Promise<void> | void
  isMutating?: boolean
}

type ListingRowEntry = {
  item: WatchlistListingItem
  listing: ListingIdentity
  key: string
}

type SectionBlock = {
  section: WatchlistSectionItem
  rows: ListingRowEntry[]
}

const percentFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

const formatPrice = (value: number | null) => (value == null ? '-' : priceFormatter.format(value))
const formatPercent = (value: number | null) =>
  value == null ? '-' : `${percentFormatter.format(value)}%`

const getListingFallback = (label: string) => {
  const text = label.trim()
  if (!text) return '??'
  return text.slice(0, 2).toUpperCase()
}

export const WatchlistTable = ({
  watchlist,
  quotes,
  sort,
  onSortChange,
  onReorderItems,
  onRemoveItem,
  onRemoveSection,
  isMutating = false,
}: WatchlistTableProps) => {
  const [resolvedByKey, setResolvedByKey] = useState<Record<string, ListingOption | null>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [dropTarget, setDropTarget] = useState<WatchlistDropTarget | null>(null)
  const [sectionToDelete, setSectionToDelete] = useState<WatchlistSectionItem | null>(null)

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

      const key = resolveListingKey(item.listing)
      if (!key) continue
      const row: ListingRowEntry = {
        item,
        listing: item.listing,
        key,
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
    const pending = listingRows.filter((entry) => !(entry.key in resolvedByKey))
    if (pending.length === 0) return

    let cancelled = false
    const resolveAll = async () => {
      const resolvedEntries = await Promise.all(
        pending.map(async (entry) => ({
          key: entry.key,
          resolved: await requestListingResolution(entry.listing).catch(() => null),
        }))
      )

      if (cancelled) return
      setResolvedByKey((current) => {
        const next = { ...current }
        resolvedEntries.forEach((entry) => {
          next[entry.key] = entry.resolved
        })
        return next
      })
    }

    void resolveAll()

    return () => {
      cancelled = true
    }
  }, [listingRows, resolvedByKey])

  const sortRows = (rows: ListingRowEntry[]) => {
    if (!sort) return rows
    return sortWatchlistRowsByColumn(rows, sort, quotes, resolvedByKey)
  }

  const displayedUnsectionedRows = useMemo(
    () => sortRows(parsedRows.unsectionedRows),
    [parsedRows.unsectionedRows, sort, quotes, resolvedByKey]
  )

  const displayedSections = useMemo(
    () =>
      parsedRows.sections.map((section) => ({
        ...section,
        rows: sortRows(section.rows),
      })),
    [parsedRows.sections, sort, quotes, resolvedByKey]
  )

  const hasAnyListing = listingRows.length > 0
  const hasSections = displayedSections.length > 0
  const dragEnabled = !sort && !isMutating
  const sortableIds = useMemo(() => {
    const next: UniqueIdentifier[] = []

    if (dragEnabled && hasSections) {
      next.push(WATCHLIST_UNSECTIONED_SORTABLE_ID)
    }

    displayedUnsectionedRows.forEach((row) => {
      next.push(createWatchlistListingSortableId(row.item.id))
    })

    displayedSections.forEach((section) => {
      next.push(createWatchlistSectionSortableId(section.section.id))
      const isExpanded = expandedSections[section.section.id] ?? true
      if (!isExpanded) return
      section.rows.forEach((row) => {
        next.push(createWatchlistListingSortableId(row.item.id))
      })
    })

    return next
  }, [dragEnabled, hasSections, displayedUnsectionedRows, displayedSections, expandedSections])

  const toggleSort = (column: WatchlistColumnKey) => {
    if (!sort || sort.column !== column) {
      onSortChange({ column, direction: 'asc' })
      return
    }
    onSortChange({
      column,
      direction: sort.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  const sortIndicator = (column: WatchlistColumnKey) => {
    if (!sort || sort.column !== column) return ''
    return sort.direction === 'asc' ? ' \u2191' : ' \u2193'
  }

  const commitDrop = async (target: WatchlistDropTarget, activeSortableId: string) => {
    if (!watchlist || !dragEnabled) return
    const draggedListingId = resolveDraggedListingId(activeSortableId)
    if (!draggedListingId) return
    const nextItems = moveWatchlistListingItem(watchlist.items, draggedListingId, target)
    if (!nextItems) return
    await onReorderItems(nextItems.map((item) => item.id))
  }

  const handleMove = (activeId: UniqueIdentifier, overId: UniqueIdentifier | null) => {
    if (!dragEnabled || !overId) return
    const target = resolveDropTarget(String(overId))
    if (!target) return
    void commitDrop(target, String(activeId))
  }

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!dragEnabled) {
      setDropTarget(null)
      return
    }

    const draggedListingId = resolveDraggedListingId(String(active.id))
    if (!draggedListingId) {
      setDropTarget(null)
      return
    }

    if (!over) {
      setDropTarget(null)
      return
    }

    setDropTarget(resolveDropTarget(String(over.id)))
  }

  const resetDragState = () => {
    setDropTarget(null)
  }

  if (!watchlist || !hasAnyListing) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground text-xs'>
        No symbols in this watchlist.
      </div>
    )
  }

  const renderListingRow = (row: ListingRowEntry) => {
    const quote = quotes[row.key]
    const resolved = resolvedByKey[row.key]
    const listingLabel = resolveWatchlistListingLabel(row.listing, resolved)
    const listingName = resolved?.name?.trim() ?? ''
    const flag = getFlagData(resolved?.countryCode)
    const assetClass = resolveWatchlistAssetClass(row.listing, resolved)
    const isDropBefore = dropTarget?.type === 'before' && dropTarget.itemId === row.item.id
    const sortableId = createWatchlistListingSortableId(row.item.id)

    return (
      <SortableItem key={row.item.id} value={sortableId} asChild>
        <TableRow className={isDropBefore ? 'border-primary border-t-2' : undefined}>
          <TableCell>
            <div className='flex min-w-0 items-center gap-2'>
              <SortableItemHandle asChild disabled={!dragEnabled}>
                <button
                  type='button'
                  className='inline-flex h-4 w-4 items-center justify-center text-muted-foreground'
                  aria-label='Drag to reorder symbol'
                >
                  <GripVertical className='h-3.5 w-3.5' />
                </button>
              </SortableItemHandle>
              <Avatar className='h-5 w-5 rounded-xs bg-secondary'>
                {resolved?.iconUrl ? <AvatarImage src={resolved.iconUrl} alt={listingLabel} /> : null}
                <AvatarFallback className='text-[10px]'>
                  {getListingFallback(listingLabel)}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0'>
                <div className='truncate font-medium text-xs'>
                  {listingLabel}
                  {flag?.emoji ? <span className='ml-1'>{flag.emoji}</span> : null}
                </div>
                {listingName ? (
                  <div className='truncate text-[11px] text-muted-foreground'>{listingName}</div>
                ) : null}
              </div>
            </div>
          </TableCell>
          <TableCell className='text-right text-xs'>{assetClass}</TableCell>
          <TableCell className='text-right text-xs'>
            {formatPrice(quote?.lastPrice ?? null)}
          </TableCell>
          <TableCell
            className={`text-right text-xs ${resolveWatchlistValueColorClass(quote?.change ?? null)}`}
          >
            {formatPrice(quote?.change ?? null)}
          </TableCell>
          <TableCell
            className={`text-right text-xs ${resolveWatchlistValueColorClass(
              quote?.changePercent ?? null
            )}`}
          >
            {formatPercent(quote?.changePercent ?? null)}
          </TableCell>
          <TableCell className='text-right'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  className='h-6 w-6'
                  onClick={() => {
                    void onRemoveItem(row.item.id)
                  }}
                  disabled={isMutating}
                >
                  <X className='h-3.5 w-3.5' />
                  <span className='sr-only'>Remove symbol</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>Remove symbol</TooltipContent>
            </Tooltip>
          </TableCell>
        </TableRow>
      </SortableItem>
    )
  }

  return (
    <div className='h-full overflow-auto'>
      <Sortable
        value={sortableIds}
        onDragOver={handleDragOver}
        onDragCancel={resetDragState}
        onDragEnd={resetDragState}
        onMove={({ active, over }) => {
          handleMove(active.id, over?.id ?? null)
        }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className='min-w-[260px] cursor-pointer'
                onClick={() => toggleSort('listing')}
              >
                Listing{sortIndicator('listing')}
              </TableHead>
              <TableHead
                className='cursor-pointer text-right'
                onClick={() => toggleSort('assetClass')}
              >
                Asset class{sortIndicator('assetClass')}
              </TableHead>
              <TableHead
                className='cursor-pointer text-right'
                onClick={() => toggleSort('lastPrice')}
              >
                Last Price{sortIndicator('lastPrice')}
              </TableHead>
              <TableHead className='cursor-pointer text-right' onClick={() => toggleSort('change')}>
                Change{sortIndicator('change')}
              </TableHead>
              <TableHead
                className='cursor-pointer text-right'
                onClick={() => toggleSort('changePercent')}
              >
                Change %{sortIndicator('changePercent')}
              </TableHead>
              <TableHead className='w-12 text-right'> </TableHead>
            </TableRow>
          </TableHeader>
          <SortableContent withoutSlot>
            <TableBody>
              {dragEnabled && hasSections ? (
                <SortableItem value={WATCHLIST_UNSECTIONED_SORTABLE_ID} asChild>
                  <TableRow className={dropTarget?.type === 'unsectioned' ? 'bg-muted/50' : undefined}>
                    <TableCell colSpan={6} className='py-1 text-muted-foreground text-xs'>
                      Drop here to move outside sections
                    </TableCell>
                  </TableRow>
                </SortableItem>
              ) : null}

              {displayedUnsectionedRows.map((row) => renderListingRow(row))}

              {displayedSections.map((section) => {
                const isExpanded = expandedSections[section.section.id] ?? true
                const isDropSection =
                  dropTarget?.type === 'section' && dropTarget.sectionId === section.section.id
                const sectionSortableId = createWatchlistSectionSortableId(section.section.id)

                return (
                  <Fragment key={section.section.id}>
                    <SortableItem value={sectionSortableId} asChild>
                      <TableRow className={isDropSection ? 'bg-muted/60' : 'bg-muted/40'}>
                        <TableCell colSpan={6} className='py-1'>
                          <div className='flex items-center gap-1'>
                            <Button
                              size='icon'
                              variant='ghost'
                              className='h-5 w-5'
                              onClick={() =>
                                setExpandedSections((current) => ({
                                  ...current,
                                  [section.section.id]: !(current[section.section.id] ?? true),
                                }))
                              }
                            >
                              <ChevronRight
                                className={`h-3.5 w-3.5 transition-transform ${
                                  isExpanded ? 'rotate-90' : ''
                                }`}
                              />
                              <span className='sr-only'>
                                {isExpanded ? 'Collapse section' : 'Expand section'}
                              </span>
                            </Button>
                            <span className='font-semibold text-[11px] text-muted-foreground tracking-wide'>
                              {section.section.label}
                            </span>
                            <span className='ml-auto'>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size='icon'
                                    variant='ghost'
                                    className='h-6 w-6'
                                    onClick={() => setSectionToDelete(section.section)}
                                    disabled={isMutating}
                                  >
                                    <Trash2 className='h-3.5 w-3.5' />
                                    <span className='sr-only'>Delete section</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side='top'>Delete section</TooltipContent>
                              </Tooltip>
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    </SortableItem>
                    {isExpanded ? section.rows.map((row) => renderListingRow(row)) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </SortableContent>
        </Table>
      </Sortable>

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
                if (!sectionToDelete) return
                void onRemoveSection(sectionToDelete.id)
                setSectionToDelete(null)
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
