'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type SearchableDropdownOption = {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  iconUrl?: string | null
  group?: string
  disabled?: boolean
}

export interface SearchableDropdownProps {
  value?: string | null
  selectedOption?: SearchableDropdownOption | null
  options: SearchableDropdownOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  enableSearch?: boolean
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  isLoading?: boolean
  emptyMessage?: string
  loadingMessage?: string
  filterOptions?: boolean
  onChange?: (value: string, option?: SearchableDropdownOption) => void
}

export function SearchableDropdown({
  value,
  selectedOption,
  options,
  placeholder = 'Select an option...',
  disabled,
  className,
  enableSearch = false,
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,
  isLoading,
  emptyMessage,
  loadingMessage = 'Loading...',
  filterOptions,
  onChange,
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [internalSearch, setInternalSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const effectiveSearch = searchValue ?? internalSearch
  const shouldFilter =
    typeof filterOptions === 'boolean'
      ? filterOptions
      : enableSearch && !onSearchChange

  const normalizedSearchTerm = effectiveSearch.trim().toLowerCase()

  const displayedOptions = useMemo(() => {
    if (!enableSearch || !shouldFilter || !normalizedSearchTerm) {
      return options
    }
    return options.filter((option) => option.label.toLowerCase().includes(normalizedSearchTerm))
  }, [enableSearch, options, normalizedSearchTerm, shouldFilter])

  const groupedOptions = useMemo(() => {
    const groupOrder: string[] = []
    const grouped: Record<string, SearchableDropdownOption[]> = {}

    displayedOptions.forEach((option) => {
      const group = option.group || 'Options'
      if (!groupOrder.includes(group)) {
        groupOrder.push(group)
      }
      if (!grouped[group]) {
        grouped[group] = []
      }
      grouped[group].push(option)
    })

    return { groupOrder, grouped }
  }, [displayedOptions])

  const activeOption =
    selectedOption || options.find((opt) => opt.id === value) || undefined
  const displayLabel = activeOption?.label || value?.toString() || ''
  const ActiveIcon = activeOption?.icon || null
  const activeIconUrl = activeOption?.iconUrl

  const handleSelect = (option: SearchableDropdownOption) => {
    if (option.disabled) return
    onChange?.(option.id, option)
    setOpen(false)
    if (onSearchChange) {
      onSearchChange('')
    } else {
      setInternalSearch('')
    }
    setHighlightedIndex(-1)
    inputRef.current?.blur()
  }

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setOpen((prev) => !prev)
      if (!open) {
        inputRef.current?.focus()
      }
    }
  }

  const handleFocus = () => {
    setOpen(true)
    setHighlightedIndex(-1)
  }

  const handleBlur = () => {
    setTimeout(() => {
      const activeElement = document.activeElement
      if (!activeElement || !activeElement.closest('[data-searchable-dropdown]')) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }, 150)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setHighlightedIndex(-1)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        if (displayedOptions.length > 0) {
          setHighlightedIndex(0)
        }
      } else if (displayedOptions.length > 0) {
        setHighlightedIndex((prev) => (prev < displayedOptions.length - 1 ? prev + 1 : 0))
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open && displayedOptions.length > 0) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : displayedOptions.length - 1))
      }
    }

    if (
      e.key === 'Enter' &&
      open &&
      highlightedIndex >= 0 &&
      highlightedIndex < displayedOptions.length
    ) {
      e.preventDefault()
      const selected = displayedOptions[highlightedIndex]
      if (selected) {
        handleSelect(selected)
      }
    }
  }

  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < displayedOptions.length) {
        return prev
      }
      return -1
    })
  }, [displayedOptions])

  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `[data-option-index="${highlightedIndex}"]`
      )
      if (highlightedElement && highlightedElement instanceof HTMLElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  useEffect(() => {
    if (!enableSearch) return
    if (open) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
    const shouldReset = effectiveSearch !== ''
    if (!shouldReset) return
    if (onSearchChange) {
      onSearchChange('')
    } else {
      setInternalSearch('')
    }
  }, [open, enableSearch, onSearchChange, effectiveSearch])

  useEffect(() => {
    if (!enableSearch) return
    setHighlightedIndex(-1)
  }, [normalizedSearchTerm, enableSearch])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (open && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [open])

  const noOptionsMessage =
    enableSearch && normalizedSearchTerm
      ? 'No matching options.'
      : 'No options available.'

  return (
    <div className={cn('relative w-full', className)} data-searchable-dropdown>
      <div className='relative'>
        <Input
          ref={inputRef}
          className={cn('w-full cursor-pointer overflow-hidden pr-10 text-foreground',
            ActiveIcon || activeIconUrl ? 'pl-9' : '')}
          placeholder={placeholder}
          value={displayLabel}
          readOnly
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete='off'
        />
        {ActiveIcon && (
          <div className='pointer-events-none absolute top-0 bottom-0 left-0 flex items-center bg-transparent px-3 text-sm'>
            <ActiveIcon className='h-3 w-3' />
          </div>
        )}
        {!ActiveIcon && activeIconUrl ? (
          <div className='pointer-events-none absolute top-0 bottom-0 left-0 flex items-center bg-transparent px-3 text-sm'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activeIconUrl} alt={displayLabel} className='h-4 w-4 rounded-sm' />
          </div>
        ) : null}
        <Button
          variant='ghost'
          size='sm'
          className='absolute right-1 top-1/2 z-10 h-6 w-6 -translate-y-1/2 p-0 hover:bg-transparent'
          disabled={disabled}
          onMouseDown={handleDropdownClick}
        >
          <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      {open && (
        <div className='absolute left-0 top-full z-[100] mt-1 w-full min-w-60'>
          <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
            {enableSearch && (
              <div className='border-b border-border p-2'>
                <Input
                  ref={searchInputRef}
                  value={effectiveSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    if (onSearchChange) {
                      onSearchChange(nextValue)
                    } else {
                      setInternalSearch(nextValue)
                    }
                  }}
                  placeholder={searchPlaceholder}
                  autoComplete='off'
                  disabled={disabled}
                />
              </div>
            )}
            <div className='allow-scroll max-h-48 overflow-y-auto p-1' style={{ scrollbarWidth: 'thin' }}>
              <div ref={dropdownRef} onMouseLeave={() => setHighlightedIndex(-1)}>
                {isLoading ? (
                  <div className='py-6 text-center text-muted-foreground text-sm'>
                    {loadingMessage}
                  </div>
                ) : displayedOptions.length === 0 ? (
                  <div className='py-6 text-center text-muted-foreground text-sm'>
                    {emptyMessage || noOptionsMessage}
                  </div>
                ) : (
                  (() => {
                    let renderIndex = 0
                    return groupedOptions.groupOrder.map((group) => {
                      const groupOptions = groupedOptions.grouped[group] || []
                      return (
                        <div key={group}>
                          {groupedOptions.groupOrder.length > 1 && (
                            <div className='px-2 pb-0.5 pt-2.5 text-xs font-medium text-muted-foreground'>
                              {group}
                            </div>
                          )}
                          {groupOptions.map((option) => {
                            const isSelected = value === option.id
                            const isHighlighted = renderIndex === highlightedIndex
                            const isDisabled = Boolean(option.disabled)

                            const currentIndex = renderIndex
                            renderIndex += 1

                            return (
                              <div
                                key={option.id}
                                data-option-index={currentIndex}
                                onClick={() => !isDisabled && handleSelect(option)}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  if (!isDisabled) handleSelect(option)
                                }}
                                onMouseEnter={() => setHighlightedIndex(currentIndex)}
                                className={cn(
                                  'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                                  isHighlighted && 'bg-accent text-accent-foreground',
                                  isDisabled && 'cursor-not-allowed opacity-60'
                                )}
                              >
                                {option.icon ? (
                                  <option.icon className='mr-2 h-3 w-3' />
                                ) : option.iconUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={option.iconUrl}
                                    alt={option.label}
                                    className='mr-2 h-4 w-4 rounded-sm'
                                  />
                                ) : null}
                                <span className='flex-1 truncate'>{option.label}</span>
                                {isSelected && <Check className='ml-2 h-4 w-4 flex-shrink-0' />}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  })()
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
