'use client'

import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Check, ChevronDown, List, Pencil, Search, Trash2 } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

type WatchlistListSelectorProps = {
  watchlists: WatchlistRecord[]
  selectedWatchlist: WatchlistRecord | null
  onSelect: (watchlistId: string) => void
  onRenameWatchlist?: (watchlistId: string, name: string) => Promise<boolean> | boolean
  onDeleteWatchlist?: (watchlistId: string) => Promise<boolean> | boolean
  isRenamingWatchlist?: boolean
  isDeletingWatchlist?: boolean
  disabled?: boolean
  align?: 'start' | 'end'
}

const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

export const WatchlistListSelector = ({
  watchlists,
  selectedWatchlist,
  onSelect,
  onRenameWatchlist,
  onDeleteWatchlist,
  isRenamingWatchlist = false,
  isDeletingWatchlist = false,
  disabled = false,
  align = 'start',
}: WatchlistListSelectorProps) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [editingWatchlistId, setEditingWatchlistId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WatchlistRecord | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameSubmitInProgressRef = useRef(false)

  const searchTerm = search.trim().toLowerCase()
  const filteredWatchlists = useMemo(() => {
    const filtered = !searchTerm
      ? watchlists
      : watchlists.filter((watchlist) => watchlist.name.toLowerCase().includes(searchTerm))
    return filtered.slice(0, 100)
  }, [watchlists, searchTerm])
  const isEditing = Boolean(editingWatchlistId)
  const tooltipText = disabled ? 'Watchlist selection unavailable' : 'Select watchlist'
  const selectionLabel = selectedWatchlist?.name ?? 'Select watchlist'
  const chevronClassName =
    'h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
  const iconBadge = (
    <div
      className='h-5 w-5 rounded-xs bg-muted/60 p-0.5 text-muted-foreground'
      aria-hidden='true'
    >
      <List className='h-4 w-4' />
    </div>
  )

  const cancelRename = () => {
    setEditingWatchlistId(null)
    setEditingValue('')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSearch('')
      cancelRename()
    }
  }

  const handleSelect = (watchlistId: string) => {
    if (isEditing) return
    onSelect(watchlistId)
    setOpen(false)
    setSearch('')
  }

  const handleStartRename = (watchlist: WatchlistRecord) => {
    if (
      !onRenameWatchlist ||
      disabled ||
      isRenamingWatchlist ||
      isDeletingWatchlist ||
      watchlist.isSystem
    ) {
      return
    }
    setEditingWatchlistId(watchlist.id)
    setEditingValue(watchlist.name)
  }

  const submitRename = async () => {
    if (!onRenameWatchlist || !editingWatchlistId) return
    const target = watchlists.find((entry) => entry.id === editingWatchlistId)
    if (!target || target.isSystem) {
      cancelRename()
      return
    }

    const nextName = editingValue.trim()
    if (!nextName || nextName === target.name) {
      cancelRename()
      return
    }

    renameSubmitInProgressRef.current = true
    try {
      const renamed = await onRenameWatchlist(target.id, nextName)
      if (!renamed) return
      cancelRename()
    } finally {
      renameSubmitInProgressRef.current = false
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !onDeleteWatchlist || isDeletingWatchlist) return
    const deleted = await onDeleteWatchlist(deleteTarget.id)
    if (!deleted) return
    if (editingWatchlistId === deleteTarget.id) {
      cancelRename()
    }
    setDeleteTarget(null)
  }

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      return
    }
  }

  const stopItemAction = (
    event:
      | MouseEvent<HTMLElement>
      | PointerEvent<HTMLElement>
      | FocusEvent<HTMLElement>
  ) => {
    event.stopPropagation()
  }

  useEffect(() => {
    if (!editingWatchlistId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [editingWatchlistId])

  useEffect(() => {
    if (!editingWatchlistId) return
    if (watchlists.some((entry) => entry.id === editingWatchlistId)) return
    cancelRename()
  }, [editingWatchlistId, watchlists])

  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  disabled={disabled}
                  className={widgetHeaderControlClassName(
                    cn('group flex min-w-[220px] items-center justify-between gap-2')
                  )}
                  aria-haspopup='listbox'
                >
                  {iconBadge}
                  {selectedWatchlist ? (
                    <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
                      {selectionLabel}
                    </span>
                  ) : (
                    <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
                      {selectionLabel}
                    </span>
                  )}
                  <ChevronDown className={chevronClassName} aria-hidden='true' />
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{tooltipText}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align={align}
          sideOffset={6}
          className={cn(
            widgetHeaderMenuContentClassName,
            'max-h-[20rem] w-[240px] overflow-hidden p-0 shadow-lg'
          )}
          style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className='flex h-full max-h-[inherit] flex-col'>
            <div className='border-border/70 border-b p-2'>
              <div className='flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-muted-foreground text-sm'>
                <Search className='h-3.5 w-3.5 shrink-0' />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder='Search watchlists...'
                  className='h-6 border-0 bg-transparent px-0 text-foreground text-xs placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                  onKeyDown={handleSearchInputKeyDown}
                  autoComplete='off'
                  autoCorrect='off'
                  spellCheck='false'
                  disabled={disabled}
                />
              </div>
            </div>
            <div className='h-full min-h-0 flex-1 overflow-hidden'>
              <ScrollArea
                className={cn(
                  'h-full w-full px-2 py-2',
                  '[&_[data-radix-scroll-area-viewport]>div]:!block',
                  '[&_[data-radix-scroll-area-viewport]>div]:w-full',
                  '[&_[data-radix-scroll-area-viewport]>div]:max-w-full',
                  '[&_[data-radix-scroll-area-viewport]>div]:overflow-hidden'
                )}
                style={{ height: DROPDOWN_VIEWPORT_HEIGHT }}
              >
                {filteredWatchlists.length === 0 ? (
                  <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
                    No watchlists found.
                  </p>
                ) : (
                  <div className='flex w-full min-w-0 flex-col gap-1'>
                    {filteredWatchlists.map((watchlist) => {
                      const isSelected = watchlist.id === selectedWatchlist?.id
                      const isEditingRow = watchlist.id === editingWatchlistId
                      const canRenameRow =
                        Boolean(onRenameWatchlist) &&
                        !disabled &&
                        !isRenamingWatchlist &&
                        !isDeletingWatchlist &&
                        !watchlist.isSystem
                      const canDeleteRow =
                        Boolean(onDeleteWatchlist) &&
                        !disabled &&
                        !isRenamingWatchlist &&
                        !isDeletingWatchlist &&
                        !watchlist.isSystem

                      return (
                        <DropdownMenuItem
                          key={watchlist.id}
                          className={cn(
                            widgetHeaderMenuItemClassName,
                            'group/watchlist items-center gap-2'
                          )}
                          onSelect={(event) => {
                            event.preventDefault()
                            handleSelect(watchlist.id)
                          }}
                        >
                          {isEditingRow ? (
                            <input
                              ref={renameInputRef}
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              onBlur={() => {
                                if (renameSubmitInProgressRef.current) return
                                void submitRename()
                              }}
                              onClick={(event) => {
                                event.stopPropagation()
                              }}
                              onFocus={stopItemAction}
                              onMouseDown={stopItemAction}
                              onPointerDown={stopItemAction}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelRename()
                                  return
                                }
                                if (event.key !== 'Enter') return
                                event.preventDefault()
                                void submitRename()
                              }}
                              className='h-5 min-w-0 flex-1 bg-transparent text-left text-sm outline-none'
                              disabled={isRenamingWatchlist || isDeletingWatchlist}
                            />
                          ) : (
                            <>
                              <Check
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  isSelected ? 'text-foreground' : 'text-transparent'
                                )}
                              />
                              <span
                                className={cn(
                                  widgetHeaderMenuTextClassName,
                                  'min-w-0 flex-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                                )}
                              >
                                <span className='inline-block'>{watchlist.name}</span>
                              </span>
                            </>
                          )}

                          {!isEditingRow && (canRenameRow || canDeleteRow) ? (
                            <div className='pointer-events-none ml-1 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/watchlist:pointer-events-auto group-focus-within/watchlist:opacity-100 group-hover/watchlist:pointer-events-auto group-hover/watchlist:opacity-100'>
                              {canRenameRow ? (
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon'
                                  className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                  }}
                                  onPointerDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    handleStartRename(watchlist)
                                  }}
                                  aria-label={`Rename ${watchlist.name}`}
                                >
                                  <Pencil className='!h-3.5 !w-3.5' />
                                </Button>
                              ) : null}
                              {canDeleteRow ? (
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon'
                                  className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                  }}
                                  onPointerDown={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setDeleteTarget(watchlist)
                                  }}
                                  aria-label={`Delete ${watchlist.name}`}
                                >
                                  <Trash2 className='!h-3.5 !w-3.5' />
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (nextOpen || isDeletingWatchlist) return
          setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete watchlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This action will permanently delete "${deleteTarget.name}".`
                : 'This action will permanently delete this watchlist.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingWatchlist}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingWatchlist}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
