'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { SearchableDropdown } from '@/components/ui/searchable-dropdown'
import { useDebounce } from '@/hooks/use-debounce'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { cn } from '@/lib/utils'
import { getMarketProviderConfig } from '@/providers/market/providers'
import { MarketListingRow, getListingPrimary } from '@/components/market/market-listing-row'
import { fetchCurrencies, fetchEquity, fetchListings } from '@/components/market/market-fetchers'
import {
  parseCategorizedSearchQuery,
  serializeArrayParam,
  type ParsedMarketQuery,
  uniqueStrings,
} from '@/components/market/market-search-utils'
import {
  triggerCryptoRankUpdate,
  triggerCurrencyRankUpdate,
  triggerListingRankUpdate,
} from '@/components/market/market-rank-updates'
import {
  createEmptyMarketSelectorInstance,
  useMarketSelectorStore,
  type CurrencyOption,
  type ListingOption,
} from '@/stores/market/selector/store'

export interface MarketSelectorComboProps {
  instanceId: string
  blockId?: string
  className?: string
  disabled?: boolean
  onListingChange?: (listing: ListingOption | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
  listingRequired?: boolean
}

export interface StockSelectorProps {
  instanceId: string
  blockId?: string
  disabled?: boolean
  className?: string
  onListingChange?: (listing: ListingOption | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
}

export interface CurrencySelectorProps {
  instanceId: string
  disabled?: boolean
  className?: string
  onCurrencyChange?: (currencyId: string | undefined, currency?: CurrencyOption | null) => void
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
  blockId,
  disabled,
  className,
  onListingChange,
  onListingValueChange,
  onListingTagSelect,
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
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [variableCommitted, setVariableCommitted] = useState(false)
  const effectiveQuery = open && !query.trim() ? query : debouncedQuery
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const providerConfig = useMemo(
    () => (providerId ? getMarketProviderConfig(providerId) : null),
    [providerId]
  )
  const providerEquityQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableEquityQuote ?? [])
  }, [providerConfig])
  const providerCurrencyQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableCurrencyQuote ?? [])
  }, [providerConfig])
  const providerCryptoQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableCryptoQuote ?? [])
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

  const isVariableListingInput = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return false
    return trimmed.startsWith('<')
  }

  const commitVariableValue = (value: string, source: 'input' | 'tag' = 'input') => {
    updateInstance(instanceId, {
      query: value,
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingId: undefined,
      selectedListing: null,
    })
    setVariableCommitted(true)
    if (source === 'tag') {
      onListingTagSelect?.(value)
      onListingValueChange?.(value)
      return
    }
    onListingValueChange?.(value)
  }

  const clearVariableValue = () => {
    updateInstance(instanceId, {
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingId: undefined,
      selectedListing: null,
    })
    setVariableCommitted(false)
    onListingValueChange?.(null)
  }

  useEffect(() => {
    const rawQuery = effectiveQuery
    const trimmed = rawQuery.trim()
    if (!open) {
      if (!trimmed) {
        updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      }
      return
    }

    if (isVariableListingInput(trimmed)) {
      updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      return
    }

    const queryParams: Record<string, string> = {}
    const filtersPayload: Record<string, unknown> = {
      limit: 50,
    }
    const parsedQuery: ParsedMarketQuery = trimmed ? parseCategorizedSearchQuery(trimmed) : {}
    const resolvedAssetClasses = parsedQuery.assetClass
      ? [parsedQuery.assetClass]
      : providerAssetClasses.length
        ? providerAssetClasses
        : assetClass
          ? [assetClass]
          : []
    if (resolvedAssetClasses.length) {
      filtersPayload.asset_class = resolvedAssetClasses
    }
    const normalizedAssetClasses = resolvedAssetClasses.map((value) => value.toLowerCase())
    const includeCrypto =
      normalizedAssetClasses.length === 0 || normalizedAssetClasses.includes('crypto')
    const includeCurrency =
      normalizedAssetClasses.length === 0 || normalizedAssetClasses.includes('currency')
    const includeEquity =
      normalizedAssetClasses.length === 0 ||
      normalizedAssetClasses.some((value) => value !== 'crypto' && value !== 'currency')

    const resolvedMicCodes = providerMicCodes.length
      ? providerMicCodes
      : micCode
        ? [micCode]
        : []
    if (resolvedMicCodes.length && includeEquity) {
      filtersPayload.mic = resolvedMicCodes
    }

    if (includeEquity && providerEquityQuoteCodes.length) {
      queryParams.equity_quote_code = serializeArrayParam(providerEquityQuoteCodes)
    }
    if (includeCrypto && providerCryptoQuoteCodes.length) {
      queryParams.crypto_quote_code = serializeArrayParam(providerCryptoQuoteCodes)
    }
    if (includeCurrency && providerCurrencyQuoteCodes.length) {
      queryParams.currency_quote_code = serializeArrayParam(providerCurrencyQuoteCodes)
    }

    if (trimmed) {
      queryParams.search_query = rawQuery
    }
    if (parsedQuery.region) {
      filtersPayload.region = [parsedQuery.region]
    }
    if (Object.keys(filtersPayload).length > 0) {
      queryParams.filters = JSON.stringify(filtersPayload)
    }

    const requestKey = JSON.stringify({
      trimmed,
      rawQuery,
      providerId,
      assetClasses: resolvedAssetClasses,
      micCodes: resolvedMicCodes,
      equityQuoteCodes: providerEquityQuoteCodes,
      cryptoQuoteCodes: providerCryptoQuoteCodes,
      currencyQuoteCodes: providerCurrencyQuoteCodes,
      parsedQuery,
      filters: filtersPayload,
    })
    requestKeyRef.current = requestKey

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    updateInstance(instanceId, { isLoading: true, error: undefined })

    const requestPromise = fetchListings(queryParams, controller.signal)

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
    effectiveQuery,
    providerId,
    providerAssetClasses,
    providerMicCodes,
    providerEquityQuoteCodes,
    providerCurrencyQuoteCodes,
    providerCryptoQuoteCodes,
    micCode,
    instanceId,
    updateInstance,
  ])

  useEffect(() => {
    if (!selectedListingId) return
    if (selectedListing?.id === selectedListingId) return

    let cancelled = false
    const isEquityId = /^TG_LSTG_/i.test(selectedListingId)
    if (isEquityId) {
      fetchEquity({ equity_id: selectedListingId })
        .then((rows) => {
          if (cancelled) return
          const listing = rows[0]
          if (listing) {
            updateInstance(instanceId, { selectedListing: listing })
            onListingChange?.(listing)
          }
        })
        .catch(() => {
          // Ignore listing detail failures.
        })
    }

    return () => {
      cancelled = true
    }
  }, [selectedListingId, selectedListing, assetClass, instanceId, updateInstance, onListingChange])

  const selectedLabel = useMemo(() => {
    if (!selectedListing) return ''
    const primary = getListingPrimary(selectedListing)
    const quote = selectedListing.quote?.trim()
    return quote ? `${primary}/${quote}` : primary
  }, [selectedListing])

  const displayValue = open ? query : selectedLabel || query
  const showRichOverlay = !open && !!selectedListing
  const showTagOverlay = !open && !selectedListing && Boolean(query?.trim().includes('<'))
  const showListingDropdown = open && !showTags
  const hideInputText = showRichOverlay || showTagOverlay

  const handleSelect = (listing: ListingOption) => {
    const primary = getListingPrimary(listing)
    const quote = listing.quote?.trim()
    const nextLabel = quote ? `${primary}/${quote}` : primary
    updateInstance(instanceId, {
      selectedListingId: listing.id,
      selectedListing: listing,
      query: nextLabel,
      results: [],
      error: undefined,
    })
    setOpen(false)
    setHighlightedIndex(-1)
    setShowTags(false)
    setVariableCommitted(false)
    if (listing.equity_id) {
      triggerListingRankUpdate(listing.equity_id)
    }
    if (listing.base_asset_class === 'crypto' && listing.base_id) {
      triggerCryptoRankUpdate(listing.base_id)
    }
    if (listing.base_asset_class === 'currency' && listing.base_id) {
      triggerCurrencyRankUpdate(listing.base_id)
    }
    onListingChange?.(listing)
  }

  const handleTagSelect = (value: string) => {
    const lastOpen = value.lastIndexOf('<')
    const lastClose = value.indexOf('>', lastOpen + 1)
    const rawTag =
      lastOpen >= 0
        ? value.slice(lastOpen + 1, lastClose >= 0 ? lastClose : value.length)
        : value
    const trimmedTag = rawTag.trim()
    const normalizedValue = trimmedTag ? `<${trimmedTag}>` : value
    commitVariableValue(normalizedValue, 'tag')
    setShowTags(false)
    setOpen(false)
    setHighlightedIndex(-1)
    setCursorPosition(normalizedValue.length)
  }

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (open) return
    if (!selectedLabel) return
    if (query === selectedLabel) return
    updateInstance(instanceId, { query: selectedLabel })
  }, [open, query, selectedLabel, instanceId, updateInstance])

  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < results.length) {
        return prev
      }
      return -1
    })
  }, [results])

  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return
    const target = dropdownRef.current.querySelector(
      `[data-option-index="${highlightedIndex}"]`
    )
    if (target && target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  return (
    <div
      className={cn('relative w-full', className)}
      data-market-selector
    >
      <div className='relative'>
        <Input
          ref={inputRef}
          className={cn(
            'w-full pr-10',
            hideInputText && 'text-transparent caret-transparent placeholder:text-transparent'
          )}
          placeholder='Search listings...'
          value={displayValue}
          onChange={(event) => {
            if (disabled) return
            const nextValue = event.target.value
            const newCursorPosition = event.target.selectionStart ?? nextValue.length
            setCursorPosition(newCursorPosition)
            const tagTrigger = blockId ? checkTagTrigger(nextValue, newCursorPosition) : { show: false }
            setShowTags(Boolean(blockId) && tagTrigger.show)

            if (!nextValue.trim()) {
              clearVariableValue()
              setShowTags(false)
              return
            }

            const isVariable = isVariableListingInput(nextValue)
            if (!isVariable && variableCommitted) {
              setVariableCommitted(false)
              onListingValueChange?.(null)
            }

            if (isVariable) {
              commitVariableValue(nextValue)
              return
            }

            const patch: Partial<typeof safeInstance> = { query: nextValue }
            if (selectedListing && selectedLabel && nextValue.trim() !== selectedLabel) {
              patch.selectedListingId = undefined
              patch.selectedListing = null
            }
            updateInstance(instanceId, patch)
          }}
          onFocus={() => {
            if (disabled) return
            setOpen(true)
            setHighlightedIndex(-1)
            const position = inputRef.current?.selectionStart ?? query.length
            setCursorPosition(position)
            const tagTrigger = blockId ? checkTagTrigger(query, position) : { show: false }
            setShowTags(Boolean(blockId) && tagTrigger.show)
          }}
          onBlur={() => {
            if (disabled) return
            setTimeout(() => {
              const activeElement = document.activeElement
              if (!activeElement || !activeElement.closest('[data-market-selector]')) {
                if (isVariableListingInput(query)) {
                  commitVariableValue(query)
                }
                setOpen(false)
                setHighlightedIndex(-1)
                if (selectedLabel && query !== selectedLabel) {
                  updateInstance(instanceId, { query: selectedLabel })
                }
              }
            }, 150)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              setHighlightedIndex(-1)
              setShowTags(false)
              return
            }

            if (showTags) {
              return
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) {
                setOpen(true)
                if (results.length > 0) {
                  setHighlightedIndex(0)
                }
              } else if (results.length > 0) {
                setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
              }
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (open && results.length > 0) {
                setHighlightedIndex((prev) =>
                  prev > 0 ? prev - 1 : results.length - 1
                )
              }
            }

            if (event.key === 'Enter' && open && highlightedIndex >= 0) {
              event.preventDefault()
              const selected = results[highlightedIndex]
              if (selected) {
                handleSelect(selected)
              }
              return
            }

            if (event.key === 'Enter' && isVariableListingInput(query)) {
              event.preventDefault()
              commitVariableValue(query)
              setOpen(false)
              setHighlightedIndex(-1)
            }
          }}
          disabled={disabled}
          autoComplete='off'
        />
        {showRichOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center px-1 w-full'>
            <MarketListingRow listing={selectedListing} showAssetClass className='w-full' />
          </div>
        ) : null}
        {showTagOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center px-3 w-full'>
            <div className='w-full truncate text-sm'>
              {formatDisplayText(query, {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
        ) : null}
        <Button
          variant='ghost'
          size='sm'
          className='absolute right-1 top-1/2 z-10 h-6 w-6 -translate-y-1/2 p-0 hover:bg-transparent'
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault()
            if (disabled) return
            setOpen((prev) => {
              const next = !prev
              if (!next) {
                setShowTags(false)
              }
              return next
            })
            if (!open) {
              inputRef.current?.focus()
            }
          }}
        >
          <ChevronDown
            className={cn('h-4 w-4 opacity-0 transition-transform', open && 'rotate-180 opacity-50')}
          />
        </Button>
      </div>

      {showListingDropdown && (
        <div className='absolute left-0 top-full z-[100] mt-1 w-full'>
          <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
            <div
              ref={dropdownRef}
              className='allow-scroll max-h-64 overflow-y-auto p-1'
              style={{ scrollbarWidth: 'thin' }}
              onMouseLeave={() => setHighlightedIndex(-1)}
            >
              {isLoading ? (
                <div className='py-6 text-center text-sm text-muted-foreground'>
                  Searching...
                </div>
              ) : results.length === 0 ? (
                <div className='py-6 text-center text-sm text-muted-foreground'>
                  {error || 'No listings found.'}
                </div>
              ) : (
                results.map((listing, index) => {
                  const isHighlighted = index === highlightedIndex
                  return (
                    <div
                      key={listing.id}
                      data-option-index={index}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        handleSelect(listing)
                      }}
                      className={cn(
                        'flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                        isHighlighted && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <MarketListingRow listing={listing} showAssetClass className='w-full' />
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
      {blockId ? (
        <TagDropdown
          visible={showTags}
          onSelect={handleTagSelect}
          blockId={blockId}
          activeSourceBlockId={activeSourceBlockId}
          inputValue={query}
          cursorPosition={cursorPosition}
          allowVariables={false}
          allowContextualTags={false}
          allowedOutputTypes={['json', 'object']}
          onClose={() => {
            setShowTags(false)
            setActiveSourceBlockId(null)
          }}
        />
      ) : null}
    </div>
  )
}

export function MarketSelectorCombo({
  instanceId,
  blockId,
  className,
  disabled,
  onListingChange,
  onListingValueChange,
  onListingTagSelect,
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
          blockId={blockId}
          disabled={disabled}
          onListingChange={onListingChange}
          onListingValueChange={onListingValueChange}
          onListingTagSelect={onListingTagSelect}
        />
      </div>
    </div>
  )
}
