'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Pencil, Search, Trash2 } from 'lucide-react'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { widgetHeaderControlClassName } from '@/widgets/widgets/components/widget-header-control'

type WatchlistListSelectorProps = {
  watchlists: WatchlistRecord[]
  selectedWatchlist: WatchlistRecord | null
  onSelect: (watchlistId: string) => void
  onCreateFromSearch?: (name: string) => Promise<boolean> | boolean
  onRenameWatchlist?: (watchlistId: string, name: string) => Promise<boolean> | boolean
  onDeleteWatchlist?: (watchlistId: string) => Promise<boolean> | boolean
  isRenamingWatchlist?: boolean
  isDeletingWatchlist?: boolean
  disabled?: boolean
  isCreating?: boolean
}

export const WatchlistListSelector = ({
  watchlists,
  selectedWatchlist,
  onSelect,
  onCreateFromSearch,
  onRenameWatchlist,
  onDeleteWatchlist,
  isRenamingWatchlist = false,
  isDeletingWatchlist = false,
  disabled = false,
  isCreating = false,
}: WatchlistListSelectorProps) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [editingWatchlistId, setEditingWatchlistId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WatchlistRecord | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameSubmitInProgressRef = useRef(false)

  const trimmedSearch = search.trim()
  const searchTerm = trimmedSearch.toLowerCase()
  const filteredWatchlists = useMemo(() => {
    const filtered = !searchTerm
      ? watchlists
      : watchlists.filter((watchlist) => watchlist.name.toLowerCase().includes(searchTerm))
    return filtered.slice(0, 100)
  }, [watchlists, searchTerm])

  const canCreateFromSearch = Boolean(trimmedSearch && onCreateFromSearch)
  const isEditing = Boolean(editingWatchlistId)

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

  const handleCreate = async () => {
    if (!onCreateFromSearch || !trimmedSearch || isCreating) return
    const created = await onCreateFromSearch(trimmedSearch)
    if (!created) return
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
    <div
      className={widgetHeaderControlClassName(
        cn('min-w-[220px] gap-0 p-0', disabled && 'opacity-60')
      )}
    >
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='flex min-w-0 flex-1 items-center justify-between gap-2 px-2'
            disabled={disabled}
          >
            <span className='truncate text-left text-xs'>
              {selectedWatchlist?.name ?? 'Select watchlist'}
            </span>
            <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[280px] p-0'>
          <Command shouldFilter={false}>
            <div className='flex items-center gap-2 border-b px-3' cmdk-input-wrapper=''>
              <Search className='h-4 w-4 shrink-0 opacity-50' />
              <input
                placeholder='Search watchlists...'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void handleCreate()
                }}
                className='flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
              />
              <button
                type='button'
                className='ml-1 h-6 shrink-0 rounded-sm border border-border/70 px-2 font-semibold text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                onClick={() => {
                  void handleCreate()
                }}
                disabled={disabled || !canCreateFromSearch || isCreating}
                aria-label='Create watchlist'
              >
                CREATE
              </button>
            </div>
            <CommandList>
              <CommandEmpty>No watchlists found.</CommandEmpty>
              <CommandGroup>
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
                    <CommandItem
                      key={watchlist.id}
                      value={`${watchlist.name} ${watchlist.id}`}
                      onSelect={() => handleSelect(watchlist.id)}
                      className='group/watchlist'
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
                          className='h-5 min-w-0 flex-1 bg-transparent text-left text-xs outline-none'
                          disabled={isRenamingWatchlist || isDeletingWatchlist}
                        />
                      ) : (
                        <>
                          <Check
                            className={cn(
                              'h-3.5 w-3.5 shrink-0',
                              isSelected ? 'text-primary' : 'text-transparent'
                            )}
                          />
                          <span className='min-w-0 flex-1 truncate'>{watchlist.name}</span>
                        </>
                      )}

                      {!isEditingRow ? (
                        <>
                          {canRenameRow || canDeleteRow ? (
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
                                  onClick={(event) => {
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
                                  onClick={(event) => {
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
                        </>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

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
    </div>
  )
}
