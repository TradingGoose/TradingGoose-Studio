'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
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
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
  WatchlistSort,
} from '@/lib/watchlists/types'
import type { WatchlistQuoteSnapshot } from '@/hooks/queries/watchlist-quotes'
import { getFlagData } from '@/widgets/widgets/data_chart/utils/listing-utils'
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

type DropTarget =
  | { type: 'before'; itemId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'unsectioned' }

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

const resolveSectionAppendIndex = (items: WatchlistItem[], sectionId: string) => {
  const sectionIndex = items.findIndex((item) => item.id === sectionId && item.type === 'section')
  if (sectionIndex === -1) return null

  for (let index = sectionIndex + 1; index < items.length; index += 1) {
    if (items[index]?.type === 'section') {
      return index
    }
  }
  return items.length
}

const resolveUnsectionedInsertIndex = (items: WatchlistItem[]) => {
  const firstSectionIndex = items.findIndex((item) => item.type === 'section')
  return firstSectionIndex === -1 ? items.length : firstSectionIndex
}

const moveListingItem = (items: WatchlistItem[], draggedItemId: string, target: DropTarget) => {
  const sourceIndex = items.findIndex(
    (item) => item.id === draggedItemId && item.type === 'listing'
  )
  if (sourceIndex === -1) return null
  const draggedItem = items[sourceIndex]
  const remaining = items.filter((item) => item.id !== draggedItemId)

  let insertIndex: number | null = null

  if (target.type === 'before') {
    insertIndex = remaining.findIndex((item) => item.id === target.itemId)
    if (insertIndex === -1) return null
  } else if (target.type === 'section') {
    insertIndex = resolveSectionAppendIndex(remaining, target.sectionId)
  } else {
    insertIndex = resolveUnsectionedInsertIndex(remaining)
  }

  if (insertIndex == null) return null

  const nextItems = [
    ...remaining.slice(0, insertIndex),
    draggedItem,
    ...remaining.slice(insertIndex),
  ]
  const unchanged = nextItems.every((item, index) => item.id === items[index]?.id)
  return unchanged ? null : nextItems
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
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
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

  const commitDrop = async (target: DropTarget) => {
    if (!watchlist || !draggedItemId || !dragEnabled) return
    const nextItems = moveListingItem(watchlist.items, draggedItemId, target)
    if (!nextItems) return
    await onReorderItems(nextItems.map((item) => item.id))
  }

  const handleDrop = (target: DropTarget) => {
    if (!dragEnabled) return
    setDropTarget(target)
    void commitDrop(target).finally(() => {
      setDropTarget(null)
      setDraggedItemId(null)
    })
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

    return (
      <TableRow
        key={row.item.id}
        draggable={dragEnabled}
        className={isDropBefore ? 'border-primary border-t-2' : undefined}
        onDragStart={(event) => {
          if (!dragEnabled) return
          setDraggedItemId(row.item.id)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', row.item.id)
        }}
        onDragEnd={() => {
          setDraggedItemId(null)
          setDropTarget(null)
        }}
        onDragOver={(event) => {
          if (!dragEnabled || !draggedItemId) return
          event.preventDefault()
          setDropTarget({ type: 'before', itemId: row.item.id })
        }}
        onDrop={(event) => {
          if (!dragEnabled) return
          event.preventDefault()
          event.stopPropagation()
          handleDrop({ type: 'before', itemId: row.item.id })
        }}
      >
        <TableCell>
          <div className='flex min-w-0 items-center gap-2'>
            <GripVertical className='h-3.5 w-3.5 text-muted-foreground' />
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
    )
  }

  return (
    <div className='h-full overflow-auto'>
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
        <TableBody>
          {dragEnabled && hasSections ? (
            <TableRow
              className={dropTarget?.type === 'unsectioned' ? 'bg-muted/50' : undefined}
              onDragOver={(event) => {
                if (!draggedItemId) return
                event.preventDefault()
                setDropTarget({ type: 'unsectioned' })
              }}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                handleDrop({ type: 'unsectioned' })
              }}
            >
              <TableCell colSpan={6} className='py-1 text-muted-foreground text-xs'>
                Drop here to move outside sections
              </TableCell>
            </TableRow>
          ) : null}

          {displayedUnsectionedRows.map((row) => renderListingRow(row))}

          {displayedSections.map((section) => {
            const isExpanded = expandedSections[section.section.id] ?? true
            const isDropSection =
              dropTarget?.type === 'section' && dropTarget.sectionId === section.section.id
            return (
              <Fragment key={section.section.id}>
                <TableRow
                  className={isDropSection ? 'bg-muted/60' : 'bg-muted/40'}
                  onDragOver={(event) => {
                    if (!dragEnabled || !draggedItemId) return
                    event.preventDefault()
                    setDropTarget({ type: 'section', sectionId: section.section.id })
                  }}
                  onDrop={(event) => {
                    if (!dragEnabled) return
                    event.preventDefault()
                    event.stopPropagation()
                    handleDrop({ type: 'section', sectionId: section.section.id })
                  }}
                >
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
                {isExpanded ? section.rows.map((row) => renderListingRow(row)) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>

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
