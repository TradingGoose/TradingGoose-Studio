'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import type { ListingOption } from '@/lib/listing/identity'
import { resolveListingKey, toListingValue, toListingValueObject } from '@/lib/listing/identity'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { useMarketListingSearch } from '@/components/listing-selector/selector/use-listing-search'
import {
  triggerCryptoRankUpdate,
  triggerCurrencyRankUpdate,
  triggerEquityRankUpdate,
} from '@/components/listing-selector/listing/rank-updates'
import { widgetHeaderControlClassName } from '@/widgets/widgets/components/widget-header-control'

interface ListingSelectorProps {
  instanceId: string
  blockId?: string
  disabled?: boolean
  className?: string
  providerType?: 'market' | 'trading'
  onListingChange?: (listing: ListingOption | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
}

const getListingSymbol = (listing: ListingOption): string => {
  const base = listing.base?.trim()
  const quote = listing.quote?.trim()
  if (base) {
    return quote ? `${base}/${quote}` : base
  }
  const name = listing.name?.trim()
  if (name) return name
  return 'Listing'
}

const getListingFallback = (listing: ListingOption): string => {
  const symbol = getListingSymbol(listing).trim()
  if (!symbol) return '??'
  return symbol.slice(0, 2).toUpperCase()
}

const hasListingDetails = (listing?: ListingOption | null): boolean => {
  if (!listing) return false
  const base = listing.base?.trim()
  if (!base) return false
  if (listing.listing_type === 'equity') return true
  const quote = listing.quote?.trim()
  return Boolean(quote)
}

const getFlagData = (
  countryCode?: string | null
): { emoji: string; codepoints: string } | null => {
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
  return {
    emoji: String.fromCodePoint(firstChar, secondChar),
    codepoints: `${firstChar.toString(16)}-${secondChar.toString(16)}`,
  }
}

const ListingSelectorRow = ({ listing }: { listing?: ListingOption | null }) => {
  const symbol = listing ? getListingSymbol(listing) : ''
  const assetClassLabel = listing?.assetClass?.toUpperCase() ?? ''
  const flagData = getFlagData(listing?.countryCode)
  const prefersFlagImage =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  const flagImageUrl = flagData
    ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
    : null

  return (
    <div className='flex min-w-0 flex-1 items-center gap-2 flex items-center'>
      <Avatar className='h-4 w-4 rounded-xs bg-secondary'>
        {listing?.iconUrl ? <AvatarImage src={listing.iconUrl} alt={symbol} /> : null}
        <AvatarFallback className='text-xs text-accent-foreground'>
          {listing ? getListingFallback(listing) : '??'}
        </AvatarFallback>
      </Avatar>
      <span className='min-w-0 truncate text-sm font-medium'>
        {listing ? symbol : 'Select listing'}
      </span>
      {prefersFlagImage && flagImageUrl ? (
        <img
          src={flagImageUrl}
          alt={`${listing?.countryCode ?? ''} flag`}
          className='ml-1 h-3.5 w-3.5'
          loading='lazy'
        />
      ) : flagData?.emoji ? (
        <span className='ml-1 text-xs'>{flagData.emoji}</span>
      ) : null}
      {assetClassLabel && listing ? (
        <span className='ml-auto p-1 text-xs font-semibold text-muted-foreground'>
          {assetClassLabel}
        </span>
      ) : null}
    </div>
  )
}

export function ListingSelector({
  instanceId,
  blockId,
  disabled,
  className,
  providerType = 'market',
  onListingChange,
  onListingValueChange,
  onListingTagSelect,
}: ListingSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const instance = useListingSelectorStore((state) => state.instances[instanceId])

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyListingSelectorInstance()
  const {
    query,
    results,
    isLoading,
    error,
    selectedListing,
    providerId,
  } = safeInstance

  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [variableCommitted, setVariableCommitted] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const hydratedKeyRef = useRef<string | null>(null)
  const hydrateRequestRef = useRef(0)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const isVariableListingInput = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return false
    return trimmed.startsWith('<')
  }, [])

  const commitVariableValue = (value: string, source: 'input' | 'tag' = 'input') => {
    updateInstance(instanceId, {
      query: value,
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingValue: null,
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
      selectedListingValue: null,
      selectedListing: null,
    })
    setVariableCommitted(false)
    onListingValueChange?.(null)
    onListingChange?.(null)
  }

  useMarketListingSearch({
    open,
    query,
    providerId,
    providerType,
    instanceId,
    updateInstance,
    isVariableInput: isVariableListingInput,
  })

  const selectedLabel = useMemo(() => {
    if (!selectedListing) return ''
    return getListingSymbol(selectedListing)
  }, [selectedListing])

  const selectedListingKey = useMemo(() => {
    return resolveListingKey(safeInstance.selectedListingValue ?? selectedListing ?? null) ?? null
  }, [safeInstance.selectedListingValue, selectedListing])
  const hasUnresolvedSelection = Boolean(selectedListingKey) && !selectedListing
  const fallbackLabel = ''
  const sanitizedQuery =
    selectedListingKey && query.trim() === selectedListingKey ? '' : query
  const displayValue = open ? sanitizedQuery : selectedLabel || fallbackLabel || sanitizedQuery
  const showRichOverlay = !open && !!selectedListing
  const showTagOverlay = !open && !selectedListing && Boolean(query?.trim().includes('<'))
  const showListingDropdown = open && !showTags
  const showPlaceholderOverlay =
    !open && !selectedListing && !query?.trim() && !hasUnresolvedSelection
  const hideInputText = showRichOverlay || showTagOverlay || showPlaceholderOverlay

  const handleSelect = (listing: ListingOption) => {
    const nextLabel = getListingSymbol(listing)
    updateInstance(instanceId, {
      selectedListingValue: toListingValue(listing),
      selectedListing: listing,
      query: nextLabel,
      results: [],
      error: undefined,
    })
    setOpen(false)
    setHighlightedIndex(-1)
    setShowTags(false)
    setVariableCommitted(false)
    triggerEquityRankUpdate(listing)
    const listingType = listing.listing_type
    if (listingType === 'crypto' && listing.base_id) {
      triggerCryptoRankUpdate(listing.base_id)
    }
    if (listingType === 'currency' && listing.base_id) {
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
    const selectedValue =
      safeInstance.selectedListingValue ?? safeInstance.selectedListing ?? null
    if (!selectedValue) {
      hydratedKeyRef.current = null
      return
    }

    const identity = toListingValueObject(selectedValue)
    if (!identity) return
    const listingKey = resolveListingKey(identity)
    if (!listingKey) return

    if (safeInstance.selectedListing && hasListingDetails(safeInstance.selectedListing)) {
      hydratedKeyRef.current = listingKey
      return
    }

    if (hydratedKeyRef.current === listingKey) {
      return
    }

    hydratedKeyRef.current = listingKey
    const requestId = ++hydrateRequestRef.current
    let cancelled = false

    requestListingResolution(identity)
      .then((resolved) => {
        if (cancelled || hydrateRequestRef.current !== requestId) return
        if (!resolved) return
        updateInstance(instanceId, {
          selectedListing: resolved,
          selectedListingValue: identity,
        })
      })
      .catch(() => { })

    return () => {
      cancelled = true
    }
  }, [safeInstance.selectedListing, safeInstance.selectedListingValue, instanceId, updateInstance])

  useEffect(() => {
    if (typeof document === 'undefined') return
    setPortalTarget(document.body)
  }, [])

  useEffect(() => {
    if (!showListingDropdown) {
      setDropdownPosition(null)
      return
    }

    const updatePosition = () => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [showListingDropdown])

  useEffect(() => {
    if (open) return
    const nextLabel = selectedLabel || fallbackLabel
    if (!nextLabel) return
    if (query === nextLabel) return
    updateInstance(instanceId, { query: nextLabel })
  }, [open, query, selectedLabel, fallbackLabel, instanceId, updateInstance])

  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < results.length) {
        return prev
      }
      return -1
    })
  }, [results])

  const dropdown = showListingDropdown ? (
    <div
      className='absolute z-[1000]'
      style={{
        top: dropdownPosition?.top ?? 0,
        left: dropdownPosition?.left ?? 0,
        width: dropdownPosition?.width ?? 'auto',
      }}
      data-market-selector
      onWheel={(event) => event.stopPropagation()}
    >
      <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
        <div
          className='allow-scroll max-h-64 overflow-y-auto p-1'
          style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {isLoading ? (
            <div className='py-6 text-center text-sm text-muted-foreground'>Searching...</div>
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
                  <ListingSelectorRow listing={listing} />
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  ) : null

  return (
    <div ref={containerRef} className={cn('relative w-full', className)} data-market-selector>
      <div className='relative'>
        <input
          ref={inputRef}
          className={cn(
            widgetHeaderControlClassName(
              'w-full justify-center pr-9 text-sm font-medium'
            ),
            hideInputText && 'text-transparent caret-transparent placeholder:text-transparent'
          )}
          placeholder='Search listings...'
          autoComplete='new-password'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          value={displayValue}
          onChange={(event) => {
            if (disabled) return
            const nextValue = event.target.value
            const newCursorPosition = event.target.selectionStart ?? nextValue.length
            setCursorPosition(newCursorPosition)
            const tagTrigger = blockId
              ? checkTagTrigger(nextValue, newCursorPosition)
              : { show: false }
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
              patch.selectedListingValue = null
              patch.selectedListing = null
              onListingChange?.(null)
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
                setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
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
        />
        {showRichOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center px-1 w-full'>
            <ListingSelectorRow listing={selectedListing} />
          </div>
        ) : null}
        {showPlaceholderOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center px-1 w-full'>
            <ListingSelectorRow listing={null} />
          </div>
        ) : null}
        {showTagOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center px-1 w-full'>
            <div className='w-full truncate text-sm'>
              {formatDisplayText(query, {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
        ) : null}
        <button
          type='button'
          className='absolute right-1 top-1/2 z-10 h-6 w-6 -translate-y-1/2 p-0 bg-transparent'
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
          <ChevronDown className={cn('h-4 w-4 opacity-0 transition-transform', open && 'rotate-180 opacity-50')} />
        </button>
      </div>

      {portalTarget && dropdownPosition ? createPortal(dropdown, portalTarget) : null}

      {blockId ? (
        <TagDropdown
          visible={showTags}
          onSelect={handleTagSelect}
          blockId={blockId}
          activeSourceBlockId={blockId}
          inputValue={query}
          cursorPosition={cursorPosition}
          allowVariables={false}
          allowContextualTags={false}
          allowedOutputTypes={['json', 'object']}
          onClose={() => {
            setShowTags(false)
          }}
        />
      ) : null}
    </div>
  )
}
