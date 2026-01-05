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
import { getMarketProviderConfig } from '@/providers/market/providers'
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

function getFlagData(
  countryCode?: string | null
): { emoji: string; codepoints: string } | null {
  if (!countryCode) return null
  const code = countryCode.trim().toUpperCase()
  if (code.length !== 2) return null
  const flagOffset = 0x1f1e6
  const asciiOffset = 0x41
  const first = code.codePointAt(0)
  const second = code.codePointAt(1)
  if (first == null || second == null) return null
  if (first < asciiOffset || first > asciiOffset + 25) return null
  if (second < asciiOffset || second > asciiOffset + 25) return null
  const firstChar = first - asciiOffset + flagOffset
  const secondChar = second - asciiOffset + flagOffset
  const emoji = String.fromCodePoint(firstChar, secondChar)
  const codepoints = `${firstChar.toString(16)}-${secondChar.toString(16)}`
  return { emoji, codepoints }
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
  onCurrencyChange?: (currencyId: string | undefined, currency?: CurrencyOption | null) => void
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

function triggerListingRankUpdate(listingId: string) {
  if (!listingId) return
  const query = new URLSearchParams({ listing_id: listingId })
  void fetch(`/api/market/update/listing-rank?${query.toString()}`, {
    method: 'POST',
  }).catch(() => {
    // Best-effort update; ignore failures to avoid blocking selection.
  })
}

function serializeArrayParam(values: string[]): string {
  return `[${values.join(',')}]`
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const unique = new Set<string>()
  values.forEach((value) => {
    if (!value) return
    unique.add(value)
  })
  return Array.from(unique.values())
}

export function CurrencySelector({
  instanceId,
  disabled,
  className,
  onCurrencyChange,
}: CurrencySelectorProps) {
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
    onCurrencyChange?.(selected.id, selected)
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
    micCode,
    providerId,
  } = safeInstance

  const debouncedQuery = useDebounce(query, 400)
  const requestKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const [open, setOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const providerConfig = useMemo(
    () => (providerId ? getMarketProviderConfig(providerId) : null),
    [providerId]
  )
  const providerCurrencyCodes = useMemo(() => {
    const currency = providerConfig?.availability.currency ?? []
    return uniqueStrings(currency)
  }, [providerConfig])
  const providerAssetClasses = useMemo(() => {
    const assetClasses = providerConfig?.availability.assetClass ?? []
    return uniqueStrings(assetClasses)
  }, [providerConfig])
  const providerMicCodes = useMemo(() => {
    const map = providerConfig?.exchangeCodeToMic ?? {}
    const codes = Object.values(map).flat()
    return uniqueStrings(codes)
  }, [providerConfig])

  useEffect(() => {
    const rawQuery = debouncedQuery
    const trimmed = rawQuery.trim()
    if (!open) {
      if (!trimmed) {
        updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      }
      return
    }

    const filters: Record<string, string> = {
      limit: '50',
    }
    const resolvedAssetClasses = providerAssetClasses.length
      ? providerAssetClasses
      : assetClass
        ? [assetClass]
        : []
    if (resolvedAssetClasses.length) {
      filters.asset_class = serializeArrayParam(resolvedAssetClasses)
    }

    const resolvedMicCodes = providerMicCodes.length
      ? providerMicCodes
      : micCode
        ? [micCode]
        : []
    if (resolvedMicCodes.length) {
      filters.mic_code = serializeArrayParam(resolvedMicCodes)
    }

    if (providerCurrencyCodes.length) {
      filters.currency_code = serializeArrayParam(providerCurrencyCodes)
    }

    const requestKey = JSON.stringify({
      trimmed,
      rawQuery,
      providerId,
      assetClasses: resolvedAssetClasses,
      micCodes: resolvedMicCodes,
      currencyCodes: providerCurrencyCodes,
    })
    requestKeyRef.current = requestKey

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    updateInstance(instanceId, { isLoading: true, error: undefined })

    const requestPromise = !trimmed
      ? fetchListings(filters, controller.signal)
      : fetchListings({ ...filters, listing_search_query: rawQuery }, controller.signal)

    requestPromise
      .then((rows) => {
        if (requestKeyRef.current !== requestKey || controller.signal.aborted) return
        updateInstance(instanceId, {
          results: rows,
          isLoading: false,
          error: undefined,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        updateInstance(instanceId, {
          isLoading: false,
          error: err instanceof Error ? err.message : 'Search failed',
        })
      })
  }, [
    open,
    debouncedQuery,
    providerId,
    providerAssetClasses,
    providerMicCodes,
    providerCurrencyCodes,
    micCode,
    instanceId,
    updateInstance,
  ])

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
    triggerListingRankUpdate(listing.id)
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
            'flex w-full items-center gap-2 rounded-md border-input border p-1 text-left text-sm text-foreground transition-colors hover',
            'data-[state=open]:bg-secondary/20',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            disabled && 'cursor-not-allowed opacity-50',
            className
          )}
        >
          <Avatar className='h-6 w-6 rounded-sm m-1 text-foreground bg-secondary/60'>
            <AvatarImage src={selectedListing?.iconUrl ?? ''} alt={selectedPrimary} />
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
        <div className='border border-border p-2 rounded-t-md'>
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
                : 'No listings found.'}
            </div>
          ) : (
            results.map((listing) => {
              const primary = getListingPrimary(listing)
              const secondary = getListingSecondary(listing)
              const assetClassLabel = listing.assetClass?.toUpperCase() ?? ''
              const quote = listing.quote?.trim() || ''
              const flagData = getFlagData(listing.countryCode)
              const prefersFlagImage =
                typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
              const flagEmoji = flagData?.emoji ?? null
              const flagImageUrl = flagData
                ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
                : null
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
                    <span className='flex items-center gap-1 text-sm font-semibold'>
                      <span className='max-w-[22ch] truncate'>
                        {primary}
                        {quote ? <span className='text-muted-foreground'>/{quote}</span> : null}
                      </span>
                      {prefersFlagImage && flagImageUrl ? (
                        <img
                          src={flagImageUrl}
                          alt={`${listing.countryCode ?? ''} flag`}
                          className='ml-1 h-3.5 w-3.5'
                          loading='lazy'
                        />
                      ) : flagEmoji ? (
                        <span className='ml-1 text-xs'>{flagEmoji}</span>
                      ) : null}
                    </span>
                    <span className='max-w-[26ch] truncate text-xs text-muted-foreground'>
                      {secondary ?? '—'}
                    </span>
                  </div>
                  <span className='ml-auto text-xs font-semibold text-muted-foreground'>
                    {assetClassLabel}
                  </span>
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
}: MarketSelectorComboProps) {
  const ensureInstance = useMarketSelectorStore((state) => state.ensureInstance)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
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
