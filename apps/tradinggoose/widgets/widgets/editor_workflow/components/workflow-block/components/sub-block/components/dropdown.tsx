import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

type DropdownOptionObject = {
  label: string
  id: string
  icon?: React.ComponentType<{ className?: string }>
  group?: string
  disabled?: boolean
  dstOn?: boolean
  observesDst?: boolean
  searchLabel?: string
  rightLabel?: string
}

type DropdownOption = {
  id: string
  label: string
  searchLabel?: string
  rightLabel?: string
  icon?: React.ComponentType<{ className?: string }>
  group?: string
  disabled?: boolean
}

interface DropdownProps {
  options: Array<string | DropdownOptionObject> | (() => Array<string | DropdownOptionObject>)
  defaultValue?: string
  blockId: string
  subBlockId: string
  value?: string
  disabled?: boolean
  placeholder?: string
  config?: SubBlockConfig
  useStore?: boolean
  valueOverride?: string
  onChange?: (value: string) => void
  enableSearch?: boolean
  searchPlaceholder?: string
  contextValues?: Record<string, any>
}

export function Dropdown({
  options,
  defaultValue,
  blockId,
  subBlockId,
  value: propValue,
  disabled,
  placeholder = 'Select an option...',
  config,
  useStore = true,
  valueOverride,
  onChange,
  className,
  enableSearch = false,
  searchPlaceholder = 'Search...',
  contextValues,
}: DropdownProps & { className?: string }) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [storeInitialized, setStoreInitialized] = useState(false)
  const previousModeRef = useRef<string | null>(null)
  const previousDependencyValuesRef = useRef<string>('')
  const blockAutoDefaultRef = useRef(false)

  // For response dataMode conversion - get builderData and data sub-blocks
  const [builderData, setBuilderData] = useSubBlockValue<any[]>(blockId, 'builderData')
  const [data, setData] = useSubBlockValue<string>(blockId, 'data')

  // Keep refs with latest values to avoid stale closures
  const builderDataRef = useRef(builderData)
  const dataRef = useRef(data)

  useEffect(() => {
    builderDataRef.current = builderData
    dataRef.current = data
  }, [builderData, data])

  const resolvedConfig: SubBlockConfig = config ?? {
    id: subBlockId,
    type: 'dropdown',
    dependsOn: [],
  }

  const routeContext = useOptionalWorkflowRoute()
  const resolvedChannelId = routeContext?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID
  const routeWorkflowId = routeContext?.workflowId ?? null
  const activeWorkflowId = useWorkflowRegistry((state) =>
    state.getActiveWorkflowId(resolvedChannelId)
  )
  const resolvedWorkflowId = activeWorkflowId ?? routeWorkflowId
  const blockContextValues = useSubBlockStore((state) => {
    if (!resolvedWorkflowId) return undefined
    return (state.workflowValues[resolvedWorkflowId] as Record<string, any> | undefined)?.[blockId]
  })

  const { finalDisabled, dependencyValues, dependsOn } = useDependsOnGate(blockId, resolvedConfig, {
    disabled: disabled ?? false,
    contextValues,
  })

  const isControlled = !useStore
  const value = isControlled
    ? valueOverride
    : propValue !== undefined
      ? propValue
      : storeValue

  const fetchOptions = resolvedConfig.fetchOptions
  const [fetchedOptions, setFetchedOptions] = useState<DropdownOptionObject[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [hasFetchedOptions, setHasFetchedOptions] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fetchOptionsIfNeeded = useCallback(async () => {
    if (!fetchOptions || finalDisabled) return

    setIsLoadingOptions(true)
    setFetchError(null)
    try {
      const resolvedContextValues = contextValues ?? blockContextValues
      const options = await fetchOptions(blockId, subBlockId, {
        channelId: resolvedChannelId,
        workflowId: resolvedWorkflowId ?? null,
        contextValues: resolvedContextValues as Record<string, unknown> | undefined,
      })
      setFetchedOptions(options)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch options'
      setFetchError(errorMessage)
      setFetchedOptions([])
    } finally {
      setIsLoadingOptions(false)
      setHasFetchedOptions(true)
    }
  }, [
    fetchOptions,
    blockId,
    subBlockId,
    finalDisabled,
    contextValues,
    blockContextValues,
    resolvedChannelId,
    resolvedWorkflowId,
  ])

  const evaluatedOptions = useMemo(() => {
    const resolved = typeof options === 'function' ? options() : options
    return resolved ?? []
  }, [options, config])

  const normalizedFetchedOptions = useMemo<DropdownOptionObject[]>(() => {
    return fetchedOptions.map((opt) => ({
      id: opt.id,
      label: opt.label,
      icon: opt.icon,
      group: opt.group,
      disabled: opt.disabled,
      dstOn: opt.dstOn,
      observesDst: opt.observesDst,
      searchLabel: opt.searchLabel,
      rightLabel: opt.rightLabel,
    }))
  }, [fetchedOptions])

  const availableOptions = useMemo<Array<string | DropdownOptionObject>>(() => {
    if (fetchOptions && normalizedFetchedOptions.length > 0) {
      return normalizedFetchedOptions
    }
    return evaluatedOptions ?? []
  }, [fetchOptions, normalizedFetchedOptions, evaluatedOptions])

  const getOptionValue = (
    option:
      | string
      | {
          label: string
          id: string
          icon?: React.ComponentType<{ className?: string }>
          group?: string
          disabled?: boolean
        }
  ) => {
    return typeof option === 'string' ? option : option.id
  }

  const optionsReady = fetchOptions ? hasFetchedOptions && !isLoadingOptions && !fetchError : true
  const hasValue = value !== null && value !== undefined && value !== ''

  // Get the default option value (first option or provided defaultValue)
  const defaultOptionValue = useMemo(() => {
    if (defaultValue !== undefined) {
      return defaultValue
    }

    if (availableOptions.length > 0) {
      return getOptionValue(availableOptions[0] as any)
    }

    return undefined
  }, [defaultValue, availableOptions, getOptionValue])

  useEffect(() => {
    if (!optionsReady || !hasValue) return
    if (fetchOptions && dependsOn.length > 0) return
    const isValid = availableOptions.some((option) => getOptionValue(option as any) === value)
    if (!isValid) {
      blockAutoDefaultRef.current = true
      if (useStore) {
        setStoreValue('')
      }
      if (onChange) {
        onChange('')
      }
    }
  }, [
    optionsReady,
    hasValue,
    availableOptions,
    value,
    useStore,
    setStoreValue,
    onChange,
    fetchOptions,
    dependsOn.length,
  ])

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  useEffect(() => {
    if (fetchOptions && dependsOn.length > 0) {
      const currentDependencyValuesStr = JSON.stringify(dependencyValues)
      const previousDependencyValuesStr = previousDependencyValuesRef.current

      if (
        previousDependencyValuesStr &&
        currentDependencyValuesStr !== previousDependencyValuesStr
      ) {
        setFetchedOptions([])
        setHasFetchedOptions(false)
      }

      previousDependencyValuesRef.current = currentDependencyValuesStr
    }
  }, [dependencyValues, fetchOptions, dependsOn.length])

  useEffect(() => {
    if (value !== null && value !== undefined && value !== '') {
      blockAutoDefaultRef.current = false
    }
  }, [value])

  // Only set default value once the store is confirmed to be initialized
  // and we know the actual value is null/undefined (not just loading)
  useEffect(() => {
    if (
      useStore &&
      storeInitialized &&
      (value === null || value === undefined || value === '') &&
      resolvedWorkflowId &&
      defaultOptionValue !== undefined
    ) {
      if (blockAutoDefaultRef.current) {
        return
      }
      setStoreValue(defaultOptionValue)
    }
  }, [useStore, storeInitialized, value, defaultOptionValue, setStoreValue, resolvedWorkflowId])

  useEffect(() => {
    if (fetchOptions && !finalDisabled && !hasFetchedOptions && !isLoadingOptions) {
      fetchOptionsIfNeeded()
    }
  }, [
    fetchOptions,
    finalDisabled,
    hasFetchedOptions,
    isLoadingOptions,
    fetchOptionsIfNeeded,
    dependencyValues,
  ])

  // Helper function to normalize variable references in JSON strings
  const normalizeVariableReferences = (jsonString: string): string => {
    // Replace unquoted variable references with quoted ones
    // Pattern: <variable.name> -> "<variable.name>"
    return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
  }

  // Helper function to convert JSON string to builder data format
  const convertJsonToBuilderData = (jsonString: string): any[] => {
    try {
      // Always normalize variable references first
      const normalizedJson = normalizeVariableReferences(jsonString)
      const parsed = JSON.parse(normalizedJson)

      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([key, value]) => {
          const fieldType = inferType(value)
          const fieldValue =
            fieldType === 'object' || fieldType === 'array' ? JSON.stringify(value, null, 2) : value

          return {
            id: crypto.randomUUID(),
            name: key,
            type: fieldType,
            value: fieldValue,
            collapsed: false,
          }
        })
      }

      return []
    } catch {
      return []
    }
  }

  // Helper function to infer field type from value
  const inferType = (value: any): 'string' | 'number' | 'boolean' | 'object' | 'array' => {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object' && value !== null) return 'object'
    return 'string'
  }

  // Handle data conversion when dataMode changes
  useEffect(() => {
    if (subBlockId !== 'dataMode' || disabled) return

    const currentMode = storeValue
    const previousMode = previousModeRef.current

    // Only convert if the mode actually changed
    if (previousMode !== null && previousMode !== currentMode) {
      // Builder to Editor mode (structured → json)
      if (currentMode === 'json' && previousMode === 'structured') {
        const currentBuilderData = builderDataRef.current
        if (
          currentBuilderData &&
          Array.isArray(currentBuilderData) &&
          currentBuilderData.length > 0
        ) {
          const jsonString = ResponseBlockHandler.convertBuilderDataToJsonString(currentBuilderData)
          setData(jsonString)
        }
      }
      // Editor to Builder mode (json → structured)
      else if (currentMode === 'structured' && previousMode === 'json') {
        const currentData = dataRef.current
        if (currentData && typeof currentData === 'string' && currentData.trim().length > 0) {
          const builderArray = convertJsonToBuilderData(currentData)
          setBuilderData(builderArray)
        }
      }
    }

    // Update the previous mode ref
    previousModeRef.current = currentMode
  }, [storeValue, subBlockId, disabled, setData, setBuilderData])

  // Event handlers
  const handleSelect = (selectedValue: string) => {
    if (!finalDisabled && useStore) {
      setStoreValue(selectedValue)
    }
    if (onChange) {
      onChange(selectedValue)
    }
  }

  const buildStatusIcon = (className: string) => {
    const StatusIcon = ({ className: iconClassName }: { className?: string }) => (
      <span className={cn('inline-block rounded-full', className, iconClassName)} />
    )
    return StatusIcon
  }

  const resolveStatusIcon = (option: DropdownOptionObject) => {
    if (option.icon) return option.icon
    if (typeof option.observesDst !== 'boolean' && typeof option.dstOn !== 'boolean') {
      return undefined
    }

    if (option.observesDst === false) {
      return buildStatusIcon('bg-transparent')
    }

    if (option.dstOn === true) {
      return buildStatusIcon('bg-green-500/40')
    }

    return buildStatusIcon('bg-red-500/40')
  }

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    return availableOptions.map((option) => {
      if (typeof option === 'string') {
        return { id: option, label: option }
      }
      return {
        id: option.id,
        label: option.label,
        searchLabel: option.searchLabel,
        rightLabel: option.rightLabel,
        icon: resolveStatusIcon(option),
        group: option.group,
        disabled: option.disabled,
      }
    })
  }, [availableOptions])

  const selectedOption = dropdownOptions.find((option) => option.id === value) ?? null

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const shouldFilter = enableSearch && normalizedSearch.length > 0

  const filteredOptions = useMemo(() => {
    if (!shouldFilter) return dropdownOptions
    return dropdownOptions.filter((option) =>
      (option.searchLabel ?? option.label).toLowerCase().includes(normalizedSearch)
    )
  }, [dropdownOptions, normalizedSearch, shouldFilter])

  const groupedOptions = useMemo(() => {
    const groupOrder: string[] = []
    const grouped: Record<string, DropdownOption[]> = {}

    filteredOptions.forEach((option) => {
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
  }, [filteredOptions])

  const handleDropdownMenuOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      return
    }
    setSearchTerm('')
  }, [])

  const hasOptions = filteredOptions.length > 0
  const emptyMessage =
    fetchError || (shouldFilter ? 'No matching options.' : 'No options available.')
  const triggerLabel = selectedOption?.label ?? ''
  const triggerRightLabel = selectedOption?.rightLabel

  return (
    <DropdownMenu onOpenChange={handleDropdownMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className={cn(
            'flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            finalDisabled && 'cursor-not-allowed opacity-50',
            className
          )}
          disabled={finalDisabled}
        >
          {selectedOption?.icon ? <selectedOption.icon className='mr-2 h-3 w-3' /> : null}
          <span
            className={cn('flex-1 truncate text-left', !triggerLabel && 'text-muted-foreground')}
          >
            {triggerLabel || placeholder}
          </span>
          {triggerRightLabel ? (
            <span className='ml-2 flex-shrink-0 text-muted-foreground text-xs tabular-nums'>
              ({triggerRightLabel})
            </span>
          ) : null}
          <ChevronDown className='ml-2 h-4 w-4 flex-shrink-0 text-muted-foreground' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        portalled={false}
        align='start'
        className='w-[var(--radix-popper-anchor-width)] p-0'
        onCloseAutoFocus={(event: Event) => {
          if (!enableSearch) return
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
      >
        {enableSearch && (
          <div className='border-b border-border p-2'>
            <Input
              ref={searchInputRef}
              placeholder={searchPlaceholder || 'Search...'}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className='h-8'
            />
          </div>
        )}
        <div
          className='allow-scroll max-h-48 overflow-y-auto p-1'
          style={{ scrollbarWidth: 'thin' }}
        >
          {isLoadingOptions ? (
            <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
              Loading...
            </DropdownMenuItem>
          ) : !hasOptions ? (
            <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
              {emptyMessage}
            </DropdownMenuItem>
          ) : (
            groupedOptions.groupOrder.map((group) => {
              const groupOptions = groupedOptions.grouped[group] || []
              return (
                <div key={group}>
                  {groupedOptions.groupOrder.length > 1 && (
                    <DropdownMenuLabel className='px-2 pb-0.5 pt-2.5 text-xs font-medium text-muted-foreground'>
                      {group}
                    </DropdownMenuLabel>
                  )}
                  {groupOptions.map((option) => {
                    const isSelected = option.id === value
                    return (
                      <DropdownMenuItem
                        key={option.id}
                        disabled={option.disabled}
                        className='flex items-center'
                        onSelect={() => {
                          if (option.disabled) return
                          handleSelect(option.id)
                        }}
                      >
                        {option.icon ? <option.icon className='mr-2 h-3 w-3' /> : null}
                        <span className='flex-1 truncate'>{option.label}</span>
                        {option.rightLabel ? (
                          <span className='ml-2 flex-shrink-0 text-muted-foreground text-xs tabular-nums'>
                            ({option.rightLabel})
                          </span>
                        ) : null}
                        {isSelected && <Check className='ml-2 h-4 w-4 flex-shrink-0' />}
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
