import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Check, ChevronDown } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent } from '@/components/ui/popover'
import {
  type SidebarDropdownGroup,
  type SidebarDropdownItem,
  SidebarDropdownMenuContent,
} from '@/components/ui/sidebar-dropdown-menu'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { SubBlockConfig, SubBlockOption } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { useModelRegistry } from '@/stores/model-registry'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ComboBox')

interface ComboBoxProps {
  options: Array<string | SubBlockOption> | (() => Array<string | SubBlockOption>)
  defaultValue?: string
  blockId: string
  subBlockId: string
  inputId?: string
  value?: string
  disabled?: boolean
  placeholder?: string
  isConnecting: boolean
  config: SubBlockConfig
}

const getOptionValue = (option: string | SubBlockOption) =>
  typeof option === 'string' ? option : String(option.value ?? option.id)

const getOptionLabel = (option: string | SubBlockOption) =>
  typeof option === 'string' ? option : option.label

const getOptionGroup = (option: string | SubBlockOption) =>
  typeof option === 'string' ? 'Options' : (option.group ?? 'Options')

const getOptionSearchText = (option: string | SubBlockOption) => {
  if (typeof option === 'string') return option
  return option.searchLabel ?? option.label
}

const getOptionIcon = (option: string | SubBlockOption) =>
  typeof option === 'string' ? null : (option.icon ?? null)

/** Edits persisted selections and references, distinguishing fresh openings from typed searches. */
export function ComboBox({
  options,
  config,
  defaultValue,
  blockId,
  subBlockId,
  inputId,
  value: propValue,
  disabled,
  placeholder,
  isConnecting,
}: ComboBoxProps) {
  const locale = useLocale() as LocaleCode
  const registryLoading = useModelRegistry((state) => state.isLoading)
  const registryError = useModelRegistry((state) => state.error)
  const loadRegistry = useModelRegistry((state) => state.load)
  const usesSidebarMode = config.dropdownMode === 'sidebar'
  const isModelPicker = subBlockId === 'model' && usesSidebarMode
  const placeholderText = placeholder ?? translateWorkflowLabel(locale, 'typeOrSelectAnOption')
  const workspaceId = useWorkspaceId()
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId, disabled)
  const [storeInitialized, setStoreInitialized] = useState(false)
  const [menu, setMenu] = useState<'options' | 'environment' | 'tags' | null>(null)
  const open = menu === 'options'
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [activeSidebarGroupId, setActiveSidebarGroupId] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [hasTyped, setHasTyped] = useState(false)

  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useReactFlow()

  const value = propValue !== undefined ? propValue : storeValue
  const defaultOnEmpty = config.autoSelectFirstOption === false ? undefined : defaultValue
  const displayValue = value?.toString() || defaultOnEmpty || ''
  const showingDefault = !!defaultOnEmpty && displayValue === defaultOnEmpty

  // Evaluate options if it's a function
  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

  const selectedOption = useMemo(
    () => evaluatedOptions.find((opt) => getOptionValue(opt) === displayValue),
    [evaluatedOptions, displayValue]
  )

  const defaultOptionValue =
    defaultValue ??
    (config.autoSelectFirstOption !== false && evaluatedOptions.length
      ? getOptionValue(evaluatedOptions[0])
      : undefined)

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  useEffect(() => {
    if (
      !disabled &&
      storeInitialized &&
      (value == null || (value === '' && defaultOnEmpty)) &&
      defaultOptionValue !== undefined
    ) {
      setStoreValue(defaultOptionValue)
    }
  }, [disabled, storeInitialized, value, defaultOnEmpty, defaultOptionValue, setStoreValue])

  // Filter options based on current value for display
  const filteredOptions = useMemo(() => {
    if (!open || !hasTyped || !displayValue) return evaluatedOptions
    const search = displayValue.toLowerCase()
    return evaluatedOptions.filter((option) => {
      const label = getOptionLabel(option).toLowerCase()
      const optionValue = getOptionValue(option).toLowerCase()
      const searchLabel = getOptionSearchText(option).toLowerCase()
      return label.includes(search) || optionValue.includes(search) || searchLabel.includes(search)
    })
  }, [displayValue, evaluatedOptions, open, hasTyped])

  const sidebarItems = useMemo<SidebarDropdownItem[]>(
    () =>
      filteredOptions.map((option) => {
        const optionValue = getOptionValue(option)
        const Icon = getOptionIcon(option)
        return {
          id: optionValue,
          groupId: getOptionGroup(option),
          label: getOptionLabel(option),
          selected: value === optionValue,
          icon: Icon ? <Icon className='h-3 w-3 shrink-0' /> : null,
        }
      }),
    [value, filteredOptions]
  )

  const sidebarGroups = useMemo<SidebarDropdownGroup[]>(() => {
    const configuredSidebarGroups =
      typeof config.optionGroups === 'function'
        ? config.optionGroups()
        : (config.optionGroups ?? [])
    const groupIds = Array.from(new Set(sidebarItems.map((item) => item.groupId)))
    if (configuredSidebarGroups.length === 0) {
      return groupIds.map((groupId) => ({ id: groupId, label: groupId }))
    }

    const configuredGroupIds = new Set(configuredSidebarGroups.map((group) => group.id))
    return [
      ...configuredSidebarGroups.filter((group) => groupIds.includes(group.id)),
      ...groupIds
        .filter((groupId) => !configuredGroupIds.has(groupId))
        .map((groupId) => ({ id: groupId, label: groupId })),
    ]
  }, [config.optionGroups, sidebarItems])

  const selectedSidebarGroupId = selectedOption ? getOptionGroup(selectedOption) : null
  const currentSidebarGroupId =
    activeSidebarGroupId && sidebarGroups.some((group) => group.id === activeSidebarGroupId)
      ? activeSidebarGroupId
      : null
  const currentSelectedSidebarGroupId =
    selectedSidebarGroupId && sidebarGroups.some((group) => group.id === selectedSidebarGroupId)
      ? selectedSidebarGroupId
      : null
  const resolvedActiveSidebarGroupId =
    currentSidebarGroupId ?? currentSelectedSidebarGroupId ?? sidebarGroups[0]?.id ?? null
  const activeSidebarItems = useMemo(
    () => sidebarItems.filter((item) => item.groupId === resolvedActiveSidebarGroupId),
    [resolvedActiveSidebarGroupId, sidebarItems]
  )

  // Event handlers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0
    setHasTyped(!!newValue)

    // Update store value immediately (allow free text)
    setStoreValue(newValue || defaultOnEmpty || '')

    setCursorPosition(newCursorPosition)

    const envVarTrigger = checkEnvVarTrigger(newValue, newCursorPosition)
    setSearchTerm(envVarTrigger.searchTerm)
    if (envVarTrigger.show) setMenu('environment')
    else if (checkTagTrigger(newValue, newCursorPosition).show) setMenu('tags')
    else setMenu('options')
  }

  const handleSelect = (selectedValue: string) => {
    if (!disabled) {
      setStoreValue(selectedValue)
    }
    setHasTyped(false)
    setMenu(null)
    setHighlightedIndex(-1)
    inputRef.current?.blur()
  }

  const handleReferenceSelect = (newValue: string) => {
    emitTagSelection(newValue)
    setHasTyped(false)
  }

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setHasTyped(false)
      setMenu(open ? null : 'options')
      if (!open) {
        inputRef.current?.focus()
      }
    }
  }

  const handleFocus = () => {
    selectDefaultText()
    setMenu('options')
    setHighlightedIndex(-1)
  }

  const selectDefaultText = () => {
    if (showingDefault) inputRef.current?.select()
  }

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    setHasTyped(false)
    if (!dropdownRef.current?.contains(event.relatedTarget)) setMenu(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setHasTyped(false)
      setMenu(null)
      setHighlightedIndex(-1)
      return
    }
    if (menu === 'environment' || menu === 'tags') return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const optionCount = usesSidebarMode ? activeSidebarItems.length : filteredOptions.length
      if (!open) {
        setMenu('options')
        setHighlightedIndex(0)
      } else {
        setHighlightedIndex((prev) => (prev < optionCount - 1 ? prev + 1 : 0))
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) {
        const optionCount = usesSidebarMode ? activeSidebarItems.length : filteredOptions.length
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : optionCount - 1))
      }
    }

    if (e.key === 'Enter' && open && highlightedIndex >= 0) {
      e.preventDefault()
      if (usesSidebarMode) {
        const selectedItem = activeSidebarItems[highlightedIndex]
        if (selectedItem) {
          handleSelect(selectedItem.id)
        }
        return
      }

      const selectedOption = filteredOptions[highlightedIndex]
      if (selectedOption) {
        handleSelect(getOptionValue(selectedOption))
      }
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const text = showingDefault ? '' : displayValue
      const dropPosition = showingDefault ? 0 : (inputRef.current?.selectionStart ?? text.length)
      const newValue = `${text.slice(0, dropPosition)}<${text.slice(dropPosition)}`

      inputRef.current?.focus()

      Promise.resolve().then(() => {
        setStoreValue(newValue)
        setCursorPosition(dropPosition + 1)
        setMenu('tags')

        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = dropPosition + 1
            inputRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  // Scroll and paste handlers
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const handlePaste = () => {
    selectDefaultText()
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, 0)
  }

  // ReactFlow zoom handler
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()

      const currentZoom = reactFlowInstance.getZoom()
      const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

      const delta = e.deltaY > 0 ? 1 : -1
      const zoomFactor = 0.96 ** delta
      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 1)

      const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })

      const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
      const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

      reactFlowInstance.setViewport(
        { x: newViewportX, y: newViewportY, zoom: newZoom },
        { duration: 0 }
      )

      return false
    }
    return true
  }

  // Effects
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [displayValue])

  // Reset highlighted index when filtered options change, but preserve if within bounds
  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < filteredOptions.length) {
        return prev
      }
      return -1
    })
  }, [filteredOptions])

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `[data-option-index="${highlightedIndex}"]`
      )
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }
    }
  }, [highlightedIndex])

  const SelectedIcon = selectedOption ? getOptionIcon(selectedOption) : null

  // Render component
  return (
    <div className='relative w-full'>
      <div ref={anchorRef} className='relative'>
        <Input
          id={inputId}
          ref={inputRef}
          className={cn(
            'allow-scroll w-full overflow-auto pr-10 text-transparent caret-foreground placeholder:text-muted-foreground/50',
            isConnecting &&
              config?.connectionDroppable !== false &&
              'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500',
            SelectedIcon ? 'pl-8' : ''
          )}
          placeholder={placeholderText}
          aria-label={config.title || placeholderText}
          value={displayValue}
          onBeforeInput={selectDefaultText}
          onChange={handleChange}
          onClick={() => setMenu((current) => current ?? 'options')}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onScroll={handleScroll}
          onPaste={handlePaste}
          onWheel={handleWheel}
          disabled={disabled}
          autoComplete='off'
          style={{ overflowX: 'auto' }}
        />
        {SelectedIcon && (
          <div className='pointer-events-none absolute top-0 bottom-0 left-0 flex items-center bg-transparent pl-3 text-sm'>
            <SelectedIcon className='h-3 w-3' />
          </div>
        )}
        <div
          ref={overlayRef}
          className={cn(
            'pointer-events-none absolute top-0 bottom-0 left-0 flex items-center bg-transparent pr-0 text-sm',
            SelectedIcon ? 'pl-8' : 'pl-3'
          )}
          style={{ right: '42px' }}
        >
          <div className='w-full truncate text-foreground' style={{ scrollbarWidth: 'none' }}>
            {formatDisplayText(displayValue, {
              accessiblePrefixes,
              highlightAll: !accessiblePrefixes,
            })}
          </div>
        </div>
        {/* Chevron button */}
        <Button
          variant='ghost'
          size='sm'
          className='-translate-y-1/2 absolute top-1/2 right-1 z-10 h-6 w-6 p-0 hover:bg-transparent'
          disabled={disabled}
          onMouseDown={handleDropdownClick}
        >
          <ChevronDown
            className={cn('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')}
          />
        </Button>
      </div>

      {isModelPicker && registryLoading && (
        <p role='status' className='mt-1 text-muted-foreground text-xs'>
          {translateWorkflowLabel(locale, 'loadingModels')}
        </p>
      )}
      {isModelPicker && registryError && (
        <div role='alert' className='mt-1 text-destructive text-xs'>
          <p>{translateWorkflowLabel(locale, 'modelRegistryUnavailable')}</p>
          <Button
            variant='ghost'
            size='sm'
            disabled={registryLoading}
            onClick={() => void loadRegistry()}
          >
            {translateWorkflowLabel(locale, 'retryModels')}
          </Button>
        </div>
      )}

      {/* Dropdown */}
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          if (
            details.reason === 'outside-press' &&
            anchorRef.current &&
            details.event.composedPath().includes(anchorRef.current)
          )
            return details.cancel()
          setMenu(next ? 'options' : null)
        }}
      >
        <PopoverContent
          ref={dropdownRef}
          anchor={anchorRef}
          align='start'
          initialFocus={false}
          finalFocus={false}
          onMouseLeave={() => setHighlightedIndex(-1)}
          className={cn(
            'allow-scroll max-w-[var(--available-width)] overflow-y-auto [scrollbar-width:thin]',
            usesSidebarMode
              ? 'max-h-[var(--available-height)] w-[max(20rem,var(--anchor-width))] p-0'
              : 'max-h-[min(12rem,var(--available-height))] w-[max(15rem,var(--anchor-width))] p-1'
          )}
        >
          {usesSidebarMode ? (
            <SidebarDropdownMenuContent
              groups={sidebarGroups}
              items={sidebarItems}
              activeGroupId={resolvedActiveSidebarGroupId}
              highlightedItemId={activeSidebarItems[highlightedIndex]?.id ?? null}
              onActiveGroupChange={(groupId) => {
                setActiveSidebarGroupId(groupId)
                setHighlightedIndex(-1)
              }}
              onHighlightItem={(_item, index) => setHighlightedIndex(index)}
              onSelectItem={(item) => handleSelect(item.id)}
              loadingContent={null}
              emptyContent={translateWorkflowLabel(locale, 'noMatchingOptionsFound')}
            />
          ) : filteredOptions.length === 0 ? (
            <div className='py-6 text-center text-muted-foreground text-sm'>
              {translateWorkflowLabel(locale, 'noMatchingOptionsFound')}
            </div>
          ) : (
            filteredOptions.map((option, index) => {
              const optionValue = getOptionValue(option)
              const optionLabel = getOptionLabel(option)
              const OptionIcon = getOptionIcon(option)
              const isSelected = displayValue === optionValue
              const isHighlighted = index === highlightedIndex

              return (
                <div
                  key={optionValue}
                  data-option-index={index}
                  onClick={() => handleSelect(optionValue)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                    isHighlighted && 'bg-accent text-accent-foreground'
                  )}
                >
                  {OptionIcon && <OptionIcon className='mr-2 h-3 w-3' />}
                  <span className='flex-1 truncate'>{optionLabel}</span>
                  {isSelected && <Check className='ml-2 h-4 w-4 flex-shrink-0' />}
                </div>
              )
            })
          )}
        </PopoverContent>
      </Popover>

      <EnvVarDropdown
        visible={menu === 'environment'}
        onSelect={handleReferenceSelect}
        searchTerm={searchTerm}
        inputValue={displayValue}
        cursorPosition={cursorPosition}
        workspaceId={workspaceId}
        onClose={() => setMenu(null)}
      />
      <TagDropdown
        visible={menu === 'tags'}
        onSelect={handleReferenceSelect}
        blockId={blockId}
        activeSourceBlockId={activeSourceBlockId}
        inputValue={displayValue}
        cursorPosition={cursorPosition}
        onClose={() => {
          setMenu(null)
          setActiveSourceBlockId(null)
        }}
      />
    </div>
  )
}
