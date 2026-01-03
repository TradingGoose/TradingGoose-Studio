'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { SearchableDropdown } from '@/components/ui/searchable-dropdown'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'
import {
  createEmptyMarketSelectorInstance,
  useMarketSelectorStore,
  type CurrencyOption,
  type ListingOption,
} from '@/stores/market/selector/store'

export interface MarketSelectorComboProps {
  instanceId: string
  className?: string
  disabled?: boolean
  onListingChange?: (listingId: string | undefined, listing?: ListingOption | null) => void
  listingRequired?: boolean
  currencyRequired?: boolean
}

function getListingPrimary(listing: ListingOption): string {
  return listing.base?.trim() || listing.name?.trim() || listing.id
}

function getListingSecondary(listing: ListingOption): string | null {
  const base = listing.base?.trim()
  const name = listing.name?.trim()
  if (!name) return null
  if (base && base.toLowerCase() === name.toLowerCase()) return null
  return name
}

function getListingFallback(listing: ListingOption): string {
  const base = listing.base?.trim() || listing.name?.trim() || listing.id
  return base.slice(0, 2).toUpperCase()
}

export interface StockSelectorProps {
  instanceId: string
  disabled?: boolean
  className?: string
  onListingChange?: (listingId: string | undefined, listing?: ListingOption | null) => void
}

export interface CurrencySelectorProps {
  instanceId: string
  disabled?: boolean
  className?: string
}

async function fetchCurrencies(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<CurrencyOption[]> {
  const query = new URLSearchParams(params)
  const response = await fetch(`/api/market/search/currencies?${query.toString()}`, { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as { data?: CurrencyOption[] | CurrencyOption | null }
  if (!payload?.data) return []
  if (Array.isArray(payload.data)) return payload.data
  return [payload.data]
}

async function fetchListings(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<ListingOption[]> {
  const query = new URLSearchParams(params)
  const response = await fetch(`/api/market/search/listings?${query.toString()}`, { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as { data?: ListingOption[] | ListingOption | null }
  if (!payload?.data) return []
  if (Array.isArray(payload.data)) return payload.data
  return [payload.data]
}

function mergeListings(primary: ListingOption[], secondary: ListingOption[], limit: number) {
  const merged = new Map<string, ListingOption>()
  primary.forEach((item) => merged.set(item.id, item))
  secondary.forEach((item) => {
    if (!merged.has(item.id)) merged.set(item.id, item)
  })
  return Array.from(merged.values()).slice(0, limit)
}

export function CurrencySelector({ instanceId, disabled, className }: CurrencySelectorProps) {
  const ensureInstance = useMarketSelectorStore((state) => state.ensureInstance)
  const updateInstance = useMarketSelectorStore((state) => state.updateInstance)
  const instance = useMarketSelectorStore((state) => state.instances[instanceId])

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyMarketSelectorInstance()
  const { currencyId, currency } = safeInstance

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CurrencyOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const debouncedQuery = useDebounce(query, 350)
  const abortRef = useRef<AbortController | null>(null)
  const requestKeyRef = useRef<string>('')

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    if (!trimmed) {
      setResults([])
      setIsLoading(false)
      setError(undefined)
      return
    }

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    const requestKey = JSON.stringify({ trimmed })
    requestKeyRef.current = requestKey

    setIsLoading(true)
    setError(undefined)

    fetchCurrencies({ currency_query: trimmed, limit: '50' }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        if (requestKeyRef.current !== requestKey) return
        setResults(rows)
        setIsLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResults([])
        setIsLoading(false)
        setError(err instanceof Error ? err.message : 'Currency search failed')
      })
  }, [debouncedQuery])

  useEffect(() => {
    if (!currencyId) return
    if (currency?.id === currencyId) return

    let cancelled = false
    fetchCurrencies({ currency_id: currencyId, limit: '1' })
      .then((rows) => {
        if (cancelled) return
        const selected = rows[0]
        if (selected) {
          updateInstance(instanceId, { currencyId: selected.id, currency: selected })
        }
      })
      .catch(() => {
        // Ignore lookup errors.
      })

    return () => {
      cancelled = true
    }
  }, [currencyId, currency, instanceId, updateInstance])

  const handleSelect = (selected: CurrencyOption) => {
    updateInstance(instanceId, {
      currencyId: selected.id,
      currency: selected,
      results: [],
      error: undefined,
      selectedListingId: undefined,
      selectedListing: null,
    })
  }

  const currencyOptions = useMemo(
    () =>
      results.map((option) => ({
        id: option.id,
        label: option.code,
        iconUrl: option.iconUrl ?? undefined,
      })),
    [results]
  )

  const selectedOption = currency
    ? {
      id: currency.id,
      label: currency.code,
      iconUrl: currency.iconUrl ?? undefined,
    }
    : null

  return (
    <SearchableDropdown
      value={currencyId}
      selectedOption={selectedOption}
      options={currencyOptions}
      placeholder='Currency'
      disabled={disabled}
      className={className}
      enableSearch
      searchPlaceholder='Search currencies...'
      searchValue={query}
      onSearchChange={setQuery}
      isLoading={isLoading}
      loadingMessage='Searching...'
      emptyMessage={error ? error : 'No currencies found.'}
      filterOptions={false}
      onChange={(value) => {
        const selected = results.find((option) => option.id === value)
        if (selected) handleSelect(selected)
      }}
    />
  )
}

export function StockSelector({
  instanceId,
  disabled,
  className,
  onListingChange,
}: StockSelectorProps) {
  const ensureInstance = useMarketSelectorStore((state) => state.ensureInstance)
  const updateInstance = useMarketSelectorStore((state) => state.updateInstance)
  const instance = useMarketSelectorStore((state) => state.instances[instanceId])

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyMarketSelectorInstance()
  const {
    query,
    results,
    isLoading,
    error,
    selectedListingId,
    selectedListing,
    assetClass,
    currencyId,
    micCode,
  } = safeInstance

  const debouncedQuery = useDebounce(query, 400)
  const requestKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const [open, setOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    if (!trimmed) {
      updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      return
    }

    const filters: Record<string, string> = {
      listing_base: trimmed,
      limit: '50',
    }
    if (assetClass) filters.asset_class = assetClass
    if (currencyId) filters.currency_id = currencyId
    if (micCode) filters.mic_code = micCode

    const nameFilters = {
      ...filters,
      listing_name: trimmed,
    }
    delete (nameFilters as Record<string, string>).listing_base

    const requestKey = JSON.stringify({ trimmed, assetClass, currencyId, micCode })
    requestKeyRef.current = requestKey

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    updateInstance(instanceId, { isLoading: true, error: undefined })

    Promise.allSettled([
      fetchListings(filters, controller.signal),
      fetchListings(nameFilters, controller.signal),
    ])
      .then((responses) => {
        if (requestKeyRef.current !== requestKey || controller.signal.aborted) return

        const baseResponse = responses[0]
        const nameResponse = responses[1]
        const baseResults = baseResponse.status === 'fulfilled' ? baseResponse.value : []
        const nameResults = nameResponse.status === 'fulfilled' ? nameResponse.value : []
        const merged = mergeListings(baseResults, nameResults, 50)

        let errorMessage: string | undefined
        if (baseResponse.status === 'rejected' && nameResponse.status === 'rejected') {
          const reason = baseResponse.reason ?? nameResponse.reason
          errorMessage = reason instanceof Error ? reason.message : String(reason || 'Search failed')
        }

        updateInstance(instanceId, {
          results: merged,
          isLoading: false,
          error: errorMessage,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        updateInstance(instanceId, {
          isLoading: false,
          error: err instanceof Error ? err.message : 'Search failed',
        })
      })
  }, [debouncedQuery, assetClass, currencyId, micCode, instanceId, updateInstance])

  useEffect(() => {
    if (!selectedListingId) return
    if (selectedListing?.id === selectedListingId) return

    let cancelled = false
    fetchListings({ listing_id: selectedListingId })
      .then((rows) => {
        if (cancelled) return
        const listing = rows[0]
        if (listing) {
          updateInstance(instanceId, { selectedListing: listing })
        }
      })
      .catch(() => {
        // Ignore listing detail failures.
      })

    return () => {
      cancelled = true
    }
  }, [selectedListingId, selectedListing, instanceId, updateInstance])

  const handleSelect = (listing: ListingOption) => {
    updateInstance(instanceId, {
      selectedListingId: listing.id,
      selectedListing: listing,
      query: '',
      results: [],
      error: undefined,
    })
    onListingChange?.(listing.id, listing)
  }

  const selectedPrimary = selectedListing ? getListingPrimary(selectedListing) : ''
  const selectedSecondary = selectedListing ? getListingSecondary(selectedListing) : null

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled) return
        setOpen(nextOpen)
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border-input border p-1 text-left text-sm text-foreground transition-colors',
            'data-[state=open]:bg-secondary/20',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            disabled && 'cursor-not-allowed opacity-50',
            className
          )}
        >
          <Avatar className='h-6 w-6 rounded-sm m-1 text-foreground bg-secondary/60'>
            {selectedListing?.iconUrl ? (
              <AvatarImage src={selectedListing.iconUrl} alt={selectedPrimary} />
            ) : null}
            <AvatarFallback className='rounded-sm text-xs text-accent-foreground bg-secondary/60'>
              {selectedListing ? getListingFallback(selectedListing) : '??'}
            </AvatarFallback>
          </Avatar>
          <div className='flex min-w-0 flex-col gap-0.5 text-start leading-none'>
            <span
              className={cn(
                'max-w-[20ch] truncate text-xs font-semibold',
                !selectedListing && 'text-muted-foreground font-medium'
              )}
            >
              {selectedListing ? selectedPrimary : 'Select listing'}
            </span>
            <span className='max-w-[24ch] truncate text-xs text-muted-foreground'>
              {selectedListing
                ? selectedSecondary ?? '—'
                : 'Search by symbol or name'}
            </span>
          </div>
          <ChevronDown className='ml-auto h-4 w-4 text-muted-foreground' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='center'
        side='bottom'
        avoidCollisions
        className='allow-scroll z-30 w-[var(--radix-dropdown-menu-trigger-width)] p-0 data-[side=top]:mb-2'
        sideOffset={6}
        portalled={false}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <div className='border border-input p-2'>
          <Input
            ref={searchInputRef}
            value={query}
            placeholder='Search listings...'
            onChange={(event) => updateInstance(instanceId, { query: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
            disabled={disabled}
          />
        </div>
        <div
          className='allow-scroll max-h-64 overflow-y-auto p-1'
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {isLoading ? (
            <div className='py-6 text-center text-sm text-muted-foreground'>Searching...</div>
          ) : results.length === 0 ? (
            <div className='py-6 text-center text-sm text-muted-foreground'>
              {error
                ? error
                : query.trim().length
                  ? 'No listings found.'
                  : 'Start typing to search listings.'}
            </div>
          ) : (
            results.map((listing) => {
              const primary = getListingPrimary(listing)
              const secondary = getListingSecondary(listing)
              const isSelected = selectedListingId === listing.id
              return (
                <DropdownMenuItem
                  key={listing.id}
                  onSelect={() => handleSelect(listing)}
                  className='flex items-center gap-2 rounded-md p-2'
                >
                  <Avatar className='h-6 w-6 rounded-sm m-1 text-foreground bg-secondary/60'>
                    {listing.iconUrl ? (
                      <AvatarImage src={listing.iconUrl} alt={primary} />
                    ) : null}
                    <AvatarFallback className='rounded-sm text-xs text-accent-foreground bg-secondary/60'>
                      {getListingFallback(listing)}
                    </AvatarFallback>
                  </Avatar>
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5 text-start leading-none'>
                    <span className='max-w-[22ch] truncate text-sm font-semibold'>{primary}</span>
                    <span className='max-w-[26ch] truncate text-xs text-muted-foreground'>
                      {secondary ?? '—'}
                    </span>
                  </div>
                  {isSelected ? <Check className='ml-auto h-4 w-4' /> : null}
                </DropdownMenuItem>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function MarketSelectorCombo({
  instanceId,
  className,
  disabled,
  onListingChange,
  listingRequired,
  currencyRequired,
}: MarketSelectorComboProps) {
  const ensureInstance = useMarketSelectorStore((state) => state.ensureInstance)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div className='space-y-1.5'>
        <div className='flex items-center font-medium text-muted-foreground text-xs'>
          Currency
          {currencyRequired ? <span className='ml-1 text-red-500'>*</span> : null}
        </div>
        <CurrencySelector instanceId={instanceId} disabled={disabled} />
      </div>
      <div className='space-y-1.5'>
        <div className='flex items-center font-medium text-muted-foreground text-xs'>
          Listing
          {listingRequired ? <span className='ml-1 text-red-500'>*</span> : null}
        </div>
        <StockSelector
          instanceId={instanceId}
          disabled={disabled}
          onListingChange={onListingChange}
        />
      </div>
    </div>
  )
}
