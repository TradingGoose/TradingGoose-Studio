'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { cn } from '@/lib/utils'
import { MarketListingRow, getListingPrimary } from '@/components/listing-selector/listing/row'
import { ListingSelectorDropdown } from '@/components/listing-selector/selector/dropdown'
import {
  triggerCryptoRankUpdate,
  triggerCurrencyRankUpdate,
  triggerListingRankUpdate,
} from '@/components/listing-selector/listing/rank-updates'
import {
  resolveListingKey,
  toListingValue,
  toListingValueObject,
  type ListingOption,
} from '@/lib/listing/identity'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { useMarketListingSearch } from '@/components/listing-selector/selector/use-listing-search'

export interface StockSelectorProps {
  instanceId: string
  blockId?: string
  disabled?: boolean
  compact?: boolean
  className?: string
  providerType?: 'market' | 'trading'
  onListingChange?: (listing: ListingOption | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
}

const hasResolvedListingMetadata = (listing?: ListingOption | null): boolean => {
  if (!listing) return false
  return Boolean(listing.name?.trim() || listing.iconUrl?.trim())
}

export function StockSelector({
  instanceId,
  blockId,
  disabled,
  compact = false,
  className,
  providerType = 'market',
  onListingChange,
  onListingValueChange,
  onListingTagSelect,
}: StockSelectorProps) {
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
    const listingType = listing.listing_type
    if (listingType === 'default') {
      triggerListingRankUpdate(listing)
    }
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

    if (safeInstance.selectedListing && hasResolvedListingMetadata(safeInstance.selectedListing)) {
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

  return (
    <div
      className={cn('relative w-full', className)}
      data-market-selector
    >
      <div className='relative'>
        <Input
          ref={inputRef}
          name={`listing-search-${instanceId}`}
          className={cn(
            'w-full pr-10',
            compact ? 'h-8 text-sm' : 'h-10',
            hideInputText && 'text-transparent caret-transparent placeholder:text-transparent'
          )}
          placeholder='Select listing'
          autoComplete='off'
          data-1p-ignore='true'
          data-lpignore='true'
          data-form-type='other'
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
              patch.selectedListingValue = null
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
          type='text'
        />
        {showRichOverlay ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 flex items-center w-full',
              compact ? 'px-2' : 'px-1'
            )}
          >
            <MarketListingRow
              listing={selectedListing}
              showAssetClass={!compact}
              compact={compact}
              className='w-full'
            />
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
          <ChevronDown
            className={cn('h-4 w-4 opacity-0 transition-transform', open && 'rotate-180 opacity-50')}
          />
        </Button>
      </div>

      <ListingSelectorDropdown
        visible={showListingDropdown}
        results={results}
        isLoading={isLoading}
        error={error}
        highlightedIndex={highlightedIndex}
        onHighlightChange={setHighlightedIndex}
        onSelect={handleSelect}
      />
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
