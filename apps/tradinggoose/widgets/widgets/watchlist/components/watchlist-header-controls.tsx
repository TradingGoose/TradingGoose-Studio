'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, RefreshCw, Search, Trash2 } from 'lucide-react'
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCreateWatchlist, useDeleteWatchlist, useWatchlists } from '@/hooks/queries/watchlists'
import type { WidgetInstance } from '@/widgets/layout'
import { emitWatchlistParamsChange } from '@/widgets/utils/watchlist-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

type WatchlistHeaderControlsProps = {
  workspaceId?: string
  panelId?: string
  widget?: WidgetInstance | null
}

const resolveSelectedWatchlistId = (params: WatchlistWidgetParams | null | undefined) => {
  const raw = params?.watchlistId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null
}

const resolveProviderId = (params: WatchlistWidgetParams | null | undefined) => {
  const fromParams = typeof params?.provider === 'string' ? params.provider.trim() : ''
  if (fromParams) return fromParams
  return providerOptions[0]?.id ?? ''
}

const toEpochMs = (value?: string | null) => {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const WatchlistHeaderControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsProps) => {
  const [open, setOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const widgetKey = widget?.key ?? 'watchlist'
  const params =
    widget?.params && typeof widget.params === 'object'
      ? (widget.params as WatchlistWidgetParams)
      : null
  const selectedWatchlistId = resolveSelectedWatchlistId(params)
  const providerId = resolveProviderId(params)
  const { data: watchlists = [] } = useWatchlists(workspaceId)
  const createMutation = useCreateWatchlist()
  const deleteMutation = useDeleteWatchlist()

  const orderedWatchlists = useMemo(
    () =>
      [...watchlists].sort((left, right) => toEpochMs(right.createdAt) - toEpochMs(left.createdAt)),
    [watchlists]
  )

  const selectedWatchlist = useMemo(
    () =>
      orderedWatchlists.find((entry) => entry.id === selectedWatchlistId) ??
      orderedWatchlists[0] ??
      null,
    [orderedWatchlists, selectedWatchlistId]
  )

  const trimmedSearch = search.trim()
  const searchTerm = trimmedSearch.toLowerCase()
  const filteredWatchlists = useMemo(() => {
    const filtered = !searchTerm
      ? orderedWatchlists
      : orderedWatchlists.filter((watchlist) => watchlist.name.toLowerCase().includes(searchTerm))
    return filtered.slice(0, 100)
  }, [orderedWatchlists, searchTerm])

  const canCreateFromSearch = Boolean(trimmedSearch)
  const canDeleteCurrent = Boolean(selectedWatchlist && !selectedWatchlist.isSystem)

  const handleWatchlistPopoverOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSearch('')
    }
  }

  const handleSelect = (watchlistId: string) => {
    emitWatchlistParamsChange({
      params: {
        watchlistId,
      },
      panelId,
      widgetKey,
    })
    setOpen(false)
    setSearch('')
  }

  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return
    emitWatchlistParamsChange({
      params: {
        provider: nextProvider,
      },
      panelId,
      widgetKey,
    })
  }

  const handleRefreshData = () => {
    if (!providerId) return
    emitWatchlistParamsChange({
      params: {
        runtime: {
          refreshAt: Date.now(),
        },
      },
      panelId,
      widgetKey,
    })
  }

  const handleCreateWatchlist = async () => {
    if (!workspaceId || createMutation.isPending) return
    const name = trimmedSearch
    if (!name) return

    try {
      const watchlist = await createMutation.mutateAsync({
        workspaceId,
        name,
      })
      emitWatchlistParamsChange({
        params: {
          watchlistId: watchlist.id,
        },
        panelId,
        widgetKey,
      })
      setOpen(false)
      setSearch('')
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleDeleteWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    try {
      await deleteMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })
      setDeleteDialogOpen(false)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <Popover open={open} onOpenChange={handleWatchlistPopoverOpenChange}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className={widgetHeaderControlClassName(
              cn('min-w-[180px] justify-between gap-2', !workspaceId && 'opacity-60')
            )}
            disabled={!workspaceId}
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
                  void handleCreateWatchlist()
                }}
                className='flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
              />
              <button
                type='button'
                className='ml-1 h-6 shrink-0 rounded-sm border border-border/70 px-2 font-semibold text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                onClick={() => {
                  void handleCreateWatchlist()
                }}
                disabled={!workspaceId || !canCreateFromSearch || createMutation.isPending}
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
                  return (
                    <CommandItem
                      key={watchlist.id}
                      value={`${watchlist.name} ${watchlist.id}`}
                      onSelect={() => handleSelect(watchlist.id)}
                    >
                      <span className='truncate'>{watchlist.name}</span>
                      {isSelected ? <Check className='ml-auto h-3.5 w-3.5 text-primary' /> : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <MarketProviderSelector
        value={providerId}
        options={providerOptions}
        onChange={handleProviderChange}
        disabled={!workspaceId}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={handleRefreshData}
            disabled={!workspaceId || !providerId}
          >
            <RefreshCw className='h-3.5 w-3.5' />
            <span className='sr-only'>Refresh data</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Refresh data</TooltipContent>
      </Tooltip>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                onClick={() => setDeleteDialogOpen(true)}
                disabled={!workspaceId || !canDeleteCurrent || deleteMutation.isPending}
              >
                <Trash2 className='h-3.5 w-3.5' />
                <span className='sr-only'>Delete watchlist</span>
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>Delete watchlist</TooltipContent>
        </Tooltip>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete watchlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedWatchlist
                ? `This action will permanently delete "${selectedWatchlist.name}".`
                : 'This action will permanently delete this watchlist.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteWatchlist()
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
