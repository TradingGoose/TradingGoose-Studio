import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SearchableDropdown, type SearchableDropdownOption } from '@/components/ui/searchable-dropdown'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface DropdownProps {
  options:
  | Array<
    | string
    | {
      label: string
      id: string
      icon?: React.ComponentType<{ className?: string }>
      group?: string
      disabled?: boolean
    }
  >
  | (() => Array<
    | string
    | {
      label: string
      id: string
      icon?: React.ComponentType<{ className?: string }>
      group?: string
      disabled?: boolean
    }
  >)
  defaultValue?: string
  blockId: string
  subBlockId: string
  value?: string
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  placeholder?: string
  config?: SubBlockConfig
  useStore?: boolean
  valueOverride?: string
  onChange?: (value: string) => void
  enableSearch?: boolean
  searchPlaceholder?: string
  previewContextValues?: Record<string, any>
}

export function Dropdown({
  options,
  defaultValue,
  blockId,
  subBlockId,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled,
  placeholder = 'Select an option...',
  config,
  useStore = true,
  valueOverride,
  onChange,
  className,
  enableSearch = false,
  searchPlaceholder = 'Search...',
  previewContextValues,
}: DropdownProps & { className?: string }) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [storeInitialized, setStoreInitialized] = useState(false)
  const previousModeRef = useRef<string | null>(null)
  const previousDependencyValuesRef = useRef<string>('')

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

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const blockContextValues = useSubBlockStore((state) => {
    if (!activeWorkflowId) return undefined
    return (state.workflowValues[activeWorkflowId] as Record<string, any> | undefined)?.[blockId]
  })

  const { finalDisabled, dependencyValues, dependsOn } = useDependsOnGate(blockId, resolvedConfig, {
    disabled: disabled ?? false,
    isPreview,
    previewContextValues,
  })

  const isControlled = !useStore
  // Use preview value when in preview mode, otherwise use store value or prop value or controlled value
  const value = isPreview
    ? previewValue
    : isControlled
      ? valueOverride
      : propValue !== undefined
        ? propValue
        : storeValue


  const fetchOptions = resolvedConfig.fetchOptions
  const [fetchedOptions, setFetchedOptions] = useState<Array<{ label: string; id: string }>>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [hasFetchedOptions, setHasFetchedOptions] = useState(false)

  const fetchOptionsIfNeeded = useCallback(async () => {
    if (!fetchOptions || isPreview || finalDisabled) return

    setIsLoadingOptions(true)
    setFetchError(null)
    try {
      const contextValues = previewContextValues ?? blockContextValues
      const options = await fetchOptions(blockId, subBlockId, contextValues)
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
    isPreview,
    finalDisabled,
    previewContextValues,
    blockContextValues,
  ])

  const evaluatedOptions = useMemo(() => {
    const resolved = typeof options === 'function' ? options() : options
    return resolved ?? []
  }, [options, config])

  const normalizedFetchedOptions = useMemo(() => {
    return fetchedOptions.map((opt) => ({ label: opt.label, id: opt.id }))
  }, [fetchedOptions])

  const availableOptions = useMemo(() => {
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

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  // Only set default value once the store is confirmed to be initialized
  // and we know the actual value is null/undefined (not just loading)
  useEffect(() => {
    if (
      useStore &&
      storeInitialized &&
      (value === null || value === undefined) &&
      defaultOptionValue !== undefined
    ) {
      setStoreValue(defaultOptionValue)
    }
  }, [useStore, storeInitialized, value, defaultOptionValue, setStoreValue])

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
    if (
      fetchOptions &&
      !isPreview &&
      !finalDisabled &&
      !hasFetchedOptions &&
      !isLoadingOptions
    ) {
      fetchOptionsIfNeeded()
    }
  }, [
    fetchOptions,
    isPreview,
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
    } catch (error) {
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
    if (subBlockId !== 'dataMode' || isPreview || disabled) return

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
  }, [storeValue, subBlockId, isPreview, disabled, setData, setBuilderData])

  // Event handlers
  const handleSelect = (selectedValue: string) => {
    if (!isPreview && !finalDisabled && useStore) {
      setStoreValue(selectedValue)
    }
    if (onChange) {
      onChange(selectedValue)
    }
  }

  const dropdownOptions = useMemo<SearchableDropdownOption[]>(() => {
    return availableOptions.map((option) => {
      if (typeof option === 'string') {
        return { id: option, label: option }
      }
      return {
        id: option.id,
        label: option.label,
        icon: option.icon,
        group: option.group,
        disabled: option.disabled,
      }
    })
  }, [availableOptions])

  const selectedOption = dropdownOptions.find((option) => option.id === value) ?? null

  return (
    <SearchableDropdown
      value={value ?? undefined}
      selectedOption={selectedOption}
      options={dropdownOptions}
      placeholder={placeholder}
      disabled={finalDisabled}
      className={className}
      enableSearch={enableSearch}
      searchPlaceholder={searchPlaceholder}
      isLoading={isLoadingOptions}
      emptyMessage={fetchError ?? undefined}
      onChange={(selectedValue) => handleSelect(selectedValue)}
    />
  )
}
