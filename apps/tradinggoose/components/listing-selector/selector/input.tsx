'use client'

import type { ChangeEvent, FocusEvent, KeyboardEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  triggerCryptoRankUpdate,
  triggerCurrencyRankUpdate,
  triggerListingRankUpdate,
} from '@/components/listing-selector/listing/rank-updates'
import {
  getListingDisplaySymbol,
  ListingDisplayRow,
  MarketListingRow,
} from '@/components/listing-selector/listing/row'
import { ListingSelectorDropdownContent } from '@/components/listing-selector/selector/dropdown'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import { useMarketListingSearch } from '@/components/listing-selector/selector/use-listing-search'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { widgetHeaderControlClassName } from '@/components/widget-header-control'
import {
  areListingIdentitiesEqual,
  getListingIdentitySymbol,
  LISTING_IDENTITY_VALUE_TYPE,
  type ListingResolved,
  toListingValueObject,
} from '@/lib/listing/identity'
import { cn } from '@/lib/utils'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
import { MARKET_ASSET_CLASSES } from '@/providers/market/types'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'

export interface ListingSearchInputProps {
  instanceId: string
  blockId?: string
  disabled?: boolean
  compact?: boolean
  className?: string
  ariaLabel?: string
  variant?: 'field' | 'header'
  providerType?: 'market' | 'trading'
  marketProviderId?: string
  tradingProviderId?: string
  activateOnMount?: boolean
  candidateListings?: ListingResolved[]
  candidateListingsLoading?: boolean
  candidateListingsError?: string
  onListingChange?: (listing: ListingResolved | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
}

const ALL_ASSET_CLASS_FILTER_ID = 'all'
const LISTING_DROPDOWN_MIN_WIDTH = 420
const LISTING_DROPDOWN_VIEWPORT_PADDING = 8

const LISTING_ASSET_CLASS_GROUPS = [
  { id: ALL_ASSET_CLASS_FILTER_ID, label: 'All' },
  ...MARKET_ASSET_CLASSES.map((assetClass) => ({
    id: assetClass,
    label:
      assetClass === 'mutualfund'
        ? 'Mutual Fund'
        : assetClass.charAt(0).toUpperCase() + assetClass.slice(1),
  })),
]

export function ListingSearchInput({
  instanceId,
  blockId,
  disabled,
  compact = false,
  className,
  ariaLabel,
  variant = 'field',
  providerType = 'market',
  marketProviderId,
  tradingProviderId,
  activateOnMount = false,
  candidateListings,
  candidateListingsLoading,
  candidateListingsError,
  onListingChange,
  onListingValueChange,
  onListingTagSelect,
}: ListingSearchInputProps) {
  const isHeader = variant === 'header'
  const copy = useWorkspaceWidgetsMessages().listingSelector
  const resolvedAriaLabel = ariaLabel ?? (isHeader ? copy.searchPlaceholder : copy.selectListing)
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const instance = useListingSelectorStore((state) => state.instances[instanceId])
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const feedbackId = useId()
  const hydrateRequestRef = useRef(0)
  const hasActivatedOnMountRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [activeAssetClassFilterId, setActiveAssetClassFilterId] =
    useState(ALL_ASSET_CLASS_FILTER_ID)
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [variableCommitted, setVariableCommitted] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyListingSelectorInstance()
  const { query, results, isLoading, error, providerId } = safeInstance
  const selectedListingIdentity = toListingValueObject(safeInstance.selectedListing)
  const selectedListing =
    safeInstance.selectedListing && 'listingIdentity' in safeInstance.selectedListing
      ? safeInstance.selectedListing
      : null
  const searchBusy = isLoading
  const selectedLabel = selectedListing
    ? getListingDisplaySymbol(selectedListing)
    : selectedListingIdentity
      ? getListingIdentitySymbol(selectedListingIdentity)
      : ''
  const hasUnresolvedSelection = Boolean(selectedListingIdentity) && !selectedListing
  const displayValue = open ? query : selectedLabel || query
  const showTagOverlay = !open && !selectedListing && Boolean(query?.trim().includes('<'))
  const showListingDropdown = open && !showTags
  const showRichOverlay = !open && !!selectedListing
  const showPlaceholderOverlay =
    isHeader && !open && !selectedListing && !query?.trim() && !hasUnresolvedSelection
  const hideInputText = showRichOverlay || showTagOverlay || showPlaceholderOverlay
  const assetClassFilter =
    activeAssetClassFilterId === ALL_ASSET_CLASS_FILTER_ID ? null : activeAssetClassFilterId

  const isVariableListingInput = (value: string) => value.trim().startsWith('<')

  const commitVariableValue = (value: string, source: 'input' | 'tag' = 'input') => {
    updateInstance(instanceId, {
      query: value,
      results: [],
      isLoading: false,
      error: undefined,
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

  const clearValue = () => {
    updateInstance(instanceId, {
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListing: null,
    })
    setVariableCommitted(false)
    onListingValueChange?.(null)
  }

  const handleSelect = (listing: ListingResolved) => {
    const nextLabel = getListingDisplaySymbol(listing)
    updateInstance(instanceId, {
      selectedListing: listing,
      query: nextLabel,
      results: [],
      error: undefined,
    })
    setOpen(false)
    setHighlightedIndex(-1)
    setShowTags(false)
    setVariableCommitted(false)

    if (listing.listingIdentity.listing_type === 'default') {
      triggerListingRankUpdate(listing)
    }
    if (listing.listingIdentity.listing_type === 'crypto' && listing.listingIdentity.base_id) {
      triggerCryptoRankUpdate(listing.listingIdentity.base_id)
    }
    if (listing.listingIdentity.listing_type === 'currency' && listing.listingIdentity.base_id) {
      triggerCurrencyRankUpdate(listing.listingIdentity.base_id)
    }

    onListingChange?.(listing)
  }

  const handleAssetClassFilterChange = (groupId: string) => {
    setActiveAssetClassFilterId(groupId)
    setHighlightedIndex(-1)
    setOpen(true)
    inputRef.current?.focus()
  }

  const handleTagSelect = (value: string) => {
    const lastOpen = value.lastIndexOf('<')
    const lastClose = value.indexOf('>', lastOpen + 1)
    const rawTag =
      lastOpen >= 0 ? value.slice(lastOpen + 1, lastClose >= 0 ? lastClose : value.length) : value
    const trimmedTag = rawTag.trim()
    const normalizedValue = trimmedTag ? `<${trimmedTag}>` : value
    commitVariableValue(normalizedValue, 'tag')
    setShowTags(false)
    setOpen(false)
    setHighlightedIndex(-1)
    setCursorPosition(normalizedValue.length)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return

    const nextValue = event.target.value
    const newCursorPosition = event.target.selectionStart ?? nextValue.length
    setCursorPosition(newCursorPosition)

    const tagTrigger = blockId ? checkTagTrigger(nextValue, newCursorPosition) : { show: false }
    setShowTags(Boolean(blockId) && tagTrigger.show)

    if (!nextValue.trim()) {
      setShowTags(false)
      clearValue()
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

    setOpen(true)
    setHighlightedIndex(-1)
    const patch: Partial<typeof safeInstance> = { query: nextValue }
    if (selectedListingIdentity && nextValue.trim() !== selectedLabel) {
      patch.selectedListing = null
      onListingValueChange?.(null)
    }
    updateInstance(instanceId, patch)
  }

  const handleFocus = () => {
    if (disabled) return

    setOpen(true)
    setHighlightedIndex(-1)
    const position = inputRef.current?.selectionStart ?? query.length
    setCursorPosition(position)
    const tagTrigger = blockId ? checkTagTrigger(query, position) : { show: false }
    setShowTags(Boolean(blockId) && tagTrigger.show)
  }

  const handleBlur = (_event: FocusEvent<HTMLInputElement>) => {
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
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      setHighlightedIndex(-1)
      setShowTags(false)
      return
    }

    if (showTags) return

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
  }

  useMarketListingSearch({
    open,
    query,
    providerId,
    providerType,
    marketProviderId,
    tradingProviderId,
    assetClassFilter,
    instanceId,
    updateInstance,
    candidateListings,
    candidateListingsLoading,
    candidateListingsError,
  })

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!activateOnMount || disabled || hasActivatedOnMountRef.current) return
    hasActivatedOnMountRef.current = true
    const nextQuery = query || selectedLabel
    if (nextQuery && query !== nextQuery) {
      updateInstance(instanceId, { query: nextQuery })
    }
    setCursorPosition(nextQuery.length)
    setShowTags(false)
    setHighlightedIndex(-1)
    setOpen(true)
  }, [activateOnMount, disabled, instanceId, query, selectedLabel, updateInstance])

  useEffect(() => {
    const selectedValue = safeInstance.selectedListing
    if (!selectedValue) {
      hydrateRequestRef.current += 1
      return
    }

    const identity = toListingValueObject(selectedValue)
    if (!identity) {
      hydrateRequestRef.current += 1
      return
    }

    if (selectedListing) {
      hydrateRequestRef.current += 1
      return
    }

    const requestId = ++hydrateRequestRef.current
    let cancelled = false

    requestListingResolution(identity)
      .then((resolved) => {
        if (cancelled || hydrateRequestRef.current !== requestId) return
        if (!resolved) return
        const currentInstance = useListingSelectorStore.getState().instances[instanceId]
        const currentIdentity = toListingValueObject(currentInstance?.selectedListing)
        if (!areListingIdentitiesEqual(currentIdentity, identity)) return
        updateInstance(instanceId, { selectedListing: resolved })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [safeInstance.selectedListing, selectedListing, instanceId, updateInstance])

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
      const availableWidth = Math.max(0, window.innerWidth - LISTING_DROPDOWN_VIEWPORT_PADDING * 2)
      const width = Math.min(Math.max(rect.width, LISTING_DROPDOWN_MIN_WIDTH), availableWidth)
      const viewportLeft = window.scrollX + LISTING_DROPDOWN_VIEWPORT_PADDING
      const maxLeft = window.scrollX + window.innerWidth - width - LISTING_DROPDOWN_VIEWPORT_PADDING
      const centeredLeft = rect.left + window.scrollX + (rect.width - width) / 2
      const left = Math.max(viewportLeft, Math.min(centeredLeft, maxLeft))

      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left,
        width,
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

  const listingDropdown = showListingDropdown ? (
    <div
      className={cn(
        dropdownPosition ? 'absolute z-[1000]' : 'absolute top-full left-0 z-[200] mt-1 w-full'
      )}
      style={
        dropdownPosition
          ? {
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }
          : undefined
      }
      data-market-selector
      data-market-selector-id={instanceId}
      onWheel={(event) => event.stopPropagation()}
    >
      <ListingSelectorDropdownContent
        groups={LISTING_ASSET_CLASS_GROUPS}
        activeGroupId={activeAssetClassFilterId}
        onActiveGroupChange={handleAssetClassFilterChange}
        results={results}
        busy={searchBusy}
        error={error}
        highlightedIndex={highlightedIndex}
        onHighlightChange={setHighlightedIndex}
        onSelect={handleSelect}
        renderListing={(listing) => <ListingDisplayRow listing={listing} showSecondary />}
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      />
    </div>
  ) : null

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full', className)}
      data-market-selector
      data-market-selector-id={instanceId}
    >
      <div className='relative'>
        <Input
          ref={inputRef}
          name={`listing-search-${instanceId}`}
          aria-label={resolvedAriaLabel}
          aria-describedby={searchBusy || error ? feedbackId : undefined}
          aria-busy={searchBusy || undefined}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            isHeader
              ? widgetHeaderControlClassName('w-full justify-center font-medium text-sm')
              : ['w-full', compact ? 'h-8 text-sm' : 'h-10'],
            hideInputText && 'text-transparent caret-transparent placeholder:text-transparent'
          )}
          placeholder={isHeader ? copy.searchPlaceholder : copy.selectListing}
          autoComplete='off'
          data-1p-ignore='true'
          data-lpignore='true'
          data-form-type='other'
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          type='text'
        />
        {showRichOverlay ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 flex w-full items-center',
              isHeader ? 'px-1' : compact ? 'px-2' : 'px-1'
            )}
          >
            {isHeader ? (
              <ListingDisplayRow listing={selectedListing} />
            ) : (
              <MarketListingRow
                listing={selectedListing}
                showAssetClass={!compact}
                compact={compact}
                className='w-full'
              />
            )}
          </div>
        ) : null}
        {showPlaceholderOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex w-full items-center px-1'>
            <ListingDisplayRow listing={null} />
          </div>
        ) : null}
        {showTagOverlay ? (
          <div className='pointer-events-none absolute inset-y-0 left-0 flex w-full items-center px-3'>
            <div className='w-full truncate text-sm'>
              {formatDisplayText(query, {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
        ) : null}
      </div>
      <span
        id={feedbackId}
        role={error ? 'alert' : 'status'}
        aria-live={error ? undefined : 'polite'}
        aria-atomic='true'
        className='sr-only'
      >
        {error ? copy.unableToLoadListings : searchBusy ? copy.searching : null}
      </span>

      {listingDropdown && portalTarget && dropdownPosition
        ? createPortal(listingDropdown, portalTarget)
        : listingDropdown}
      {blockId ? (
        <TagDropdown
          visible={showTags}
          onSelect={handleTagSelect}
          blockId={blockId}
          activeSourceBlockId={null}
          inputValue={query}
          cursorPosition={cursorPosition}
          allowContextualTags={false}
          allowedOutputTypes={[LISTING_IDENTITY_VALUE_TYPE]}
          onClose={() => {
            setShowTags(false)
          }}
        />
      ) : null}
    </div>
  )
}
