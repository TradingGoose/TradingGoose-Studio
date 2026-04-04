import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Server, WrenchIcon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { SimpleTimePicker } from '@/components/ui/simple-time-picker'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import type { OAuthProvider, OAuthService } from '@/lib/oauth/oauth'
import {
  formatUtcDate,
  formatUtcDateTime,
  parseStoredTimeValue,
  resolveStoredDateValue,
} from '@/lib/time-format'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { useWorkflowMutations } from '@/lib/yjs/use-workflow-doc'
import { getAllBlocks } from '@/blocks'
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/ai/utils'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import {
  formatParameterLabel,
  getToolParametersConfig,
  isPasswordParameter,
  type ToolParameterConfig,
} from '@/tools/params'
import {
  ChannelSelectorInput,
  CheckboxList,
  Code,
  ComboBox,
  Dropdown,
  FileSelectorInput,
  FileUpload,
  ListingSelectorInput,
  LongInput,
  OrderIdSelectorInput,
  ProjectSelectorInput,
  ShortInput,
  Table,
} from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components'
import { ToolCredentialSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import {
  useWorkflowId,
  useWorkspaceId,
} from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ToolInput')

interface ToolInputProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  disabled?: boolean
}

interface StoredTool {
  type: string
  title: string
  toolId: string // Direct tool ID instead of relying on block mapping
  params: Record<string, string>
  isExpanded?: boolean
  schema?: any // For custom tools
  code?: string // For custom tools implementation
  operation?: string // For tools with multiple operations
  usageControl?: 'auto' | 'force' | 'none'
}

function GenericSyncWrapper<T = unknown>({
  blockId,
  paramId,
  value,
  onChange,
  children,
  transformer,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  transformer?: (storeValue: T) => string
}) {
  const [storeValue] = useSubBlockValue(blockId, paramId)

  useEffect(() => {
    if (storeValue) {
      const transformedValue = transformer ? transformer(storeValue) : String(storeValue)
      if (transformedValue !== value) {
        onChange(transformedValue)
      }
    }
  }, [storeValue, value, onChange, transformer])

  return <>{children}</>
}

function FileSelectorSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
  contextValues,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
  contextValues?: Record<string, any>
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <FileSelectorInput
        blockId={blockId}
        subBlock={{
          id: paramId,
          type: 'file-selector' as const,
          title: paramId,
          provider: uiComponent.provider,
          serviceId: uiComponent.serviceId,
          mimeType: uiComponent.mimeType,
          requiredScopes: uiComponent.requiredScopes || [],
          placeholder: uiComponent.placeholder,
        }}
        disabled={disabled}
        contextValues={contextValues}
      />
    </GenericSyncWrapper>
  )
}

function TableSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => JSON.stringify(storeValue)}
    >
      <Table
        blockId={blockId}
        subBlockId={paramId}
        columns={uiComponent.columns || ['Key', 'Value']}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function TimeInputSyncWrapper({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const initialSkipRef = useRef(!value)
  const dateValue = useMemo(() => parseStoredTimeValue(value), [value])

  useEffect(() => {
    initialSkipRef.current = !value
  }, [value])

  return (
    <SimpleTimePicker
      value={dateValue}
      onChange={(nextDate) => {
        if (disabled) return
        if (initialSkipRef.current) {
          initialSkipRef.current = false
          return
        }
        initialSkipRef.current = false
        onChange(format(nextDate, 'HH:mm:ss'))
      }}
      use12HourFormat
      timePicker={{ hour: true, minute: true, second: false }}
      disabled={disabled}
    />
  )
}

function DateTimeInputSyncWrapper({
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  const dateValue = useMemo(() => resolveStoredDateValue(value), [value])

  return (
    <DateTimePicker
      value={dateValue}
      onChange={(nextDate) => {
        if (disabled) return
        if (!nextDate) {
          onChange('')
          return
        }
        onChange(uiComponent.hideTime ? formatUtcDate(nextDate) : formatUtcDateTime(nextDate))
      }}
      min={resolveStoredDateValue(uiComponent.minDate)}
      max={resolveStoredDateValue(uiComponent.maxDate)}
      timezone={uiComponent.timezone}
      hideTime={uiComponent.hideTime}
      use12HourFormat={uiComponent.use12HourFormat}
      clearable={uiComponent.clearable}
      timePicker={uiComponent.timePicker}
      placeholder={uiComponent.placeholder}
      disabled={disabled}
    />
  )
}

function SliderInputSyncWrapper({
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  const min = uiComponent.min ?? 0
  const max = uiComponent.max ?? 100
  const integer = uiComponent.integer === true
  const step = uiComponent.step ?? 0.1
  const computedDefaultValue = uiComponent.defaultValue ?? (max <= 1 ? 0.7 : (min + max) / 2)
  const parsedValue = value.trim() !== '' ? Number(value) : undefined
  const hasExplicitValue = parsedValue !== undefined && !Number.isNaN(parsedValue)
  const normalizedValue = hasExplicitValue
    ? Math.max(min, Math.min(max, parsedValue))
    : computedDefaultValue
  const range = max - min || 1

  useEffect(() => {
    if (hasExplicitValue && parsedValue !== normalizedValue) {
      onChange(String(integer ? Math.round(normalizedValue) : normalizedValue))
    }
  }, [hasExplicitValue, integer, normalizedValue, onChange, parsedValue])

  return (
    <div className='relative pt-2 pb-6'>
      <Slider
        value={[normalizedValue]}
        min={min}
        max={max}
        step={integer ? 1 : step}
        onValueChange={(newValue) => {
          if (!disabled) {
            onChange(String(integer ? Math.round(newValue[0]) : newValue[0]))
          }
        }}
        disabled={disabled}
        className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4'
      />
      <div
        className='absolute text-muted-foreground text-sm'
        style={{
          left: `clamp(0%, ${((normalizedValue - min) / range) * 100}%, 100%)`,
          transform: `translateX(-${(() => {
            const percentage = ((normalizedValue - min) / range) * 100
            const bias = -25 * Math.sin((percentage * Math.PI) / 50)
            return percentage === 0 ? 0 : percentage === 100 ? 100 : 50 + bias
          })()}%)`,
          top: '24px',
        }}
      >
        {integer ? Math.round(normalizedValue).toString() : Number(normalizedValue).toFixed(1)}
      </div>
    </div>
  )
}

function CheckboxListSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => JSON.stringify(storeValue)}
    >
      <CheckboxList
        blockId={blockId}
        subBlockId={paramId}
        options={uiComponent.options || []}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function CodeSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
  isConnecting,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
  isConnecting: boolean
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <Code
        blockId={blockId}
        subBlockId={paramId}
        isConnecting={isConnecting}
        language={uiComponent.language}
        generationType={uiComponent.generationType}
        disabled={disabled}
        wandConfig={{
          enabled: false,
          prompt: '',
        }}
      />
    </GenericSyncWrapper>
  )
}

function ComboboxSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
  isConnecting,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
  isConnecting: boolean
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <ComboBox
        blockId={blockId}
        subBlockId={paramId}
        options={uiComponent.options || []}
        placeholder={uiComponent.placeholder}
        isConnecting={isConnecting}
        config={{
          id: paramId,
          type: 'combobox' as const,
          title: paramId,
        }}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function FileUploadSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => JSON.stringify(storeValue)}
    >
      <FileUpload
        blockId={blockId}
        subBlockId={paramId}
        acceptedTypes={uiComponent.acceptedTypes}
        multiple={uiComponent.multiple}
        maxSize={uiComponent.maxSize}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function ChannelSelectorSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
  contextValues,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
  contextValues?: Record<string, any>
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <ChannelSelectorInput
        blockId={blockId}
        subBlock={{
          id: paramId,
          type: 'channel-selector' as const,
          title: paramId,
          provider: uiComponent.provider || 'slack',
          placeholder: uiComponent.placeholder,
        }}
        onChannelSelect={onChange}
        disabled={disabled}
        contextValues={contextValues}
      />
    </GenericSyncWrapper>
  )
}

export function ToolInput({ blockId, subBlockId, isConnecting, disabled = false }: ToolInputProps) {
  const workspaceId = useWorkspaceId()
  const workflowId = useWorkflowId()
  const router = useRouter()
  const { setSubBlockValue: yjsSetSubBlockValue } = useWorkflowMutations()
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [modelValue] = useSubBlockValue<string | null>(blockId, 'model')
  const [toolSelectorValue, setToolSelectorValue] = useState<string | undefined>()
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const { data: customTools = [] } = useCustomTools(workspaceId)

  // MCP tools integration
  const { mcpTools } = useMcpTools(workspaceId)

  // Get the current model from the 'model' subblock
  const model = typeof modelValue === 'string' ? modelValue : ''
  const provider = model ? getProviderFromModel(model) : ''
  const supportsToolControl = provider ? supportsToolUsageControl(provider) : false

  const toolBlocks = getAllBlocks().filter(
    (block) => block.category === 'tools' && block.type !== 'evaluator'
  )

  const selectedTools: StoredTool[] =
    Array.isArray(storeValue) && storeValue.length > 0 && typeof storeValue[0] === 'object'
      ? (storeValue as unknown as StoredTool[])
      : []

  const toolSelectorOptions = useMemo(() => {
    const baseOptions: Array<{
      label: string
      id: string
      icon?: React.ComponentType<{ className?: string }>
      group?: string
    }> = [{ id: 'action:add-mcp', label: 'Create MCP Server', icon: Server, group: 'Actions' }]

    const customToolOptions =
      customTools?.map((tool) => ({
        id: `custom:${tool.id}`,
        label: tool.title,
        icon: WrenchIcon,
        group: 'Custom Tools',
      })) || []

    const mcpToolOptions =
      mcpTools?.map((tool) => ({
        id: `mcp:${tool.id}`,
        label: `${tool.name} (${tool.serverName})`,
        icon: tool.icon,
        group: 'MCP Tools',
      })) || []

    const builtInOptions = toolBlocks.map((block) => ({
      id: `builtin:${block.type}`,
      label: block.name,
      icon: block.icon,
      group: 'Built-in Tools',
    }))

    return [...baseOptions, ...customToolOptions, ...mcpToolOptions, ...builtInOptions]
  }, [customTools, mcpTools, toolBlocks])

  // Check if a tool is already selected (allowing multiple instances for multi-operation tools)
  const isToolAlreadySelected = (toolId: string, blockType: string) => {
    // For tools with multiple operations, allow multiple instances
    if (hasMultipleOperations(blockType)) {
      return false
    }
    // For single-operation tools, prevent duplicates
    return selectedTools.some((tool) => tool.toolId === toolId)
  }

  // Check if a block has multiple operations
  const hasMultipleOperations = (blockType: string): boolean => {
    const block = getAllBlocks().find((block) => block.type === blockType)
    return (block?.tools?.access?.length || 0) > 1
  }

  // Get operation options for a block
  const getOperationOptions = (blockType: string): { label: string; id: string }[] => {
    const block = getAllBlocks().find((block) => block.type === blockType)
    if (!block || !block.tools?.access) return []

    // Look for an operation dropdown in the block's subBlocks
    const operationSubBlock = block.subBlocks.find((sb) => sb.id === 'operation')
    if (
      operationSubBlock &&
      operationSubBlock.type === 'dropdown' &&
      Array.isArray(operationSubBlock.options)
    ) {
      return operationSubBlock.options as { label: string; id: string }[]
    }

    // Fallback: create options from tools.access
    return block.tools.access.map((toolId) => {
      try {
        const toolParams = getToolParametersConfig(toolId)
        return {
          id: toolId,
          label: toolParams?.toolConfig?.name || toolId,
        }
      } catch (error) {
        console.error(`Error getting tool config for ${toolId}:`, error)
        return {
          id: toolId,
          label: toolId,
        }
      }
    })
  }

  // Get the correct tool ID based on operation
  const getToolIdForOperation = (blockType: string, operation?: string): string | undefined => {
    const block = getAllBlocks().find((block) => block.type === blockType)
    if (!block || !block.tools?.access) return undefined

    // If there's only one tool, return it
    if (block.tools.access.length === 1) {
      return block.tools.access[0]
    }

    // If there's an operation and a tool selection function, use it
    if (operation && block.tools?.config?.tool) {
      try {
        return block.tools.config.tool({ operation })
      } catch (error) {
        logger.error('Error selecting tool for operation:', error)
      }
    }

    // If there's an operation that matches a tool ID, use it
    if (operation && block.tools.access.includes(operation)) {
      return operation
    }

    // Default to first tool
    return block.tools.access[0]
  }

  // Initialize tool parameters - no autofill, just return empty params
  const initializeToolParams = (): Record<string, string> => {
    return {}
  }

  const addToolToStore = (newTool: StoredTool) => {
    setStoreValue([
      ...selectedTools.map((tool) => ({
        ...tool,
        isExpanded: false,
      })),
      newTool,
    ])
  }

  const handleSelectTool = (toolBlock: (typeof toolBlocks)[0]) => {
    if (disabled) return

    const hasOperations = hasMultipleOperations(toolBlock.type)
    const operationOptions = hasOperations ? getOperationOptions(toolBlock.type) : []
    const defaultOperation = operationOptions.length > 0 ? operationOptions[0].id : undefined

    const toolId = getToolIdForOperation(toolBlock.type, defaultOperation)
    if (!toolId) return

    // Check if tool is already selected
    if (isToolAlreadySelected(toolId, toolBlock.type)) return

    // Get tool parameters using the new utility with block type for UI components
    const toolParams = getToolParametersConfig(toolId, toolBlock.type)
    if (!toolParams) return

    // Initialize parameters with auto-fill and default values
    const initialParams = initializeToolParams()

    // Add default values from UI component configurations
    toolParams.userInputParameters.forEach((param) => {
      if (param.uiComponent?.value && !initialParams[param.id]) {
        const defaultValue =
          typeof param.uiComponent.value === 'function'
            ? param.uiComponent.value()
            : param.uiComponent.value
        initialParams[param.id] = defaultValue
      }
    })

    const newTool: StoredTool = {
      type: toolBlock.type,
      title: toolBlock.name,
      toolId: toolId,
      params: initialParams,
      isExpanded: true,
      operation: defaultOperation,
      usageControl: 'auto',
    }

    addToolToStore(newTool)
  }

  const handleToolSelection = (selectedId: string) => {
    if (disabled) return

    if (selectedId === 'action:add-mcp') {
      if (workspaceId) {
        router.push(`/workspace/${workspaceId}/dashboard`)
      }
      setToolSelectorValue(undefined)
      return
    }

    if (selectedId.startsWith('custom:')) {
      const customToolId = selectedId.replace('custom:', '')
      const customTool = customTools.find((tool) => tool.id === customToolId)
      if (customTool) {
        handleAddCustomTool(customTool)
      }
      setToolSelectorValue(undefined)
      return
    }

    if (selectedId.startsWith('mcp:')) {
      const mcpToolId = selectedId.replace('mcp:', '')
      const mcpTool = mcpTools.find((tool) => tool.id === mcpToolId)
      if (mcpTool) {
        const newTool: StoredTool = {
          type: 'mcp',
          title: mcpTool.name,
          toolId: mcpTool.id,
          params: {
            serverId: mcpTool.serverId,
            toolName: mcpTool.name,
            serverName: mcpTool.serverName,
          },
          isExpanded: true,
          usageControl: 'auto',
          schema: mcpTool.inputSchema,
        }

        handleMcpToolSelect(newTool)
      }
      setToolSelectorValue(undefined)
      return
    }

    if (selectedId.startsWith('builtin:')) {
      const blockType = selectedId.replace('builtin:', '')
      const block = toolBlocks.find((b) => b.type === blockType)
      if (block) {
        handleSelectTool(block)
      }
    }

    setToolSelectorValue(undefined)
  }

  const handleAddCustomTool = (customTool: CustomToolDefinition) => {
    if (disabled) return

    const customToolId = `custom-${customTool.schema.function.name}`

    const newTool: StoredTool = {
      type: 'custom-tool',
      title: customTool.title,
      toolId: customToolId,
      params: {},
      isExpanded: true,
      schema: customTool.schema,
      code: customTool.code || '',
      usageControl: 'auto',
    }

    addToolToStore(newTool)
  }

  const handleRemoveTool = (toolIndex: number) => {
    if (disabled) return
    setStoreValue(selectedTools.filter((_, index) => index !== toolIndex))
  }

  const handleParamChange = (toolIndex: number, paramId: string, paramValue: any) => {
    if (disabled) return

    const tool = selectedTools[toolIndex]
    const currentValue = tool.params[paramId] ?? ''
    if (currentValue === paramValue) {
      return
    }

    const dependentParamIds = (() => {
      const toolParams = getToolParametersConfig(tool.toolId, tool.type, tool.params)
      const params = toolParams?.userInputParameters ?? []
      const dependencyMap = new Map<string, string[]>()

      params.forEach((param) => {
        const deps = param.uiComponent?.dependsOn ?? []
        deps.forEach((dep) => {
          const current = dependencyMap.get(dep) ?? []
          current.push(param.id)
          dependencyMap.set(dep, current)
        })
      })

      const visited = new Set<string>()
      const queue = [paramId]

      while (queue.length > 0) {
        const current = queue.shift()
        if (!current) continue
        const dependents = dependencyMap.get(current) ?? []
        dependents.forEach((dependentId) => {
          if (visited.has(dependentId)) return
          visited.add(dependentId)
          queue.push(dependentId)
        })
      }

      return Array.from(visited)
    })()

    // Update the value in the workflow
    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              params: {
                ...tool.params,
                [paramId]: paramValue,
                ...dependentParamIds.reduce<Record<string, string>>((acc, dependentId) => {
                  acc[dependentId] = ''
                  return acc
                }, {}),
              },
            }
          : tool
      )
    )
  }

  const handleOperationChange = (toolIndex: number, operation: string) => {
    if (disabled) {
      logger.info('❌ Early return: preview or disabled')
      return
    }

    const tool = selectedTools[toolIndex]

    const newToolId = getToolIdForOperation(tool.type, operation)

    if (!newToolId) {
      logger.info('❌ Early return: no newToolId')
      return
    }

    // Get parameters for the new tool
    const toolParams = getToolParametersConfig(newToolId, tool.type, tool.params)

    if (!toolParams) {
      logger.info('❌ Early return: no toolParams')
      return
    }

    // Initialize parameters for the new operation
    const initialParams = initializeToolParams()

    // Preserve ALL existing parameters that also exist in the new tool configuration
    // This mimics how regular blocks work - each field maintains its state independently
    const newParamIds = new Set(toolParams.userInputParameters.map((p) => p.id))

    // Preserve any parameter that exists in both configurations and has a value
    const preservedParams: Record<string, any> = {}
    Object.entries(tool.params).forEach(([paramId, value]) => {
      if (newParamIds.has(paramId) && value) {
        preservedParams[paramId] = value
      }
    })

    // Clear fields when operation changes for Jira (special case)
    if (tool.type === 'jira') {
      // Clear all fields that might be shared between operations
      yjsSetSubBlockValue(blockId, 'summary', '')
      yjsSetSubBlockValue(blockId, 'description', '')
      yjsSetSubBlockValue(blockId, 'issueKey', '')
      yjsSetSubBlockValue(blockId, 'projectId', '')
      yjsSetSubBlockValue(blockId, 'parentIssue', '')
    }

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              toolId: newToolId,
              operation,
              params: { ...initialParams, ...preservedParams }, // Preserve all compatible existing values
            }
          : tool
      )
    )
  }

  const handleUsageControlChange = (toolIndex: number, usageControl: string) => {
    if (disabled) return

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              usageControl: usageControl as 'auto' | 'force' | 'none',
            }
          : tool
      )
    )
  }

  const toggleToolExpansion = (toolIndex: number) => {
    if (disabled) {
      return
    }

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex ? { ...tool, isExpanded: !tool.isExpanded } : tool
      )
    )
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (disabled) return
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', '')
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (disabled || draggedIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleMcpToolSelect = (newTool: StoredTool) => {
    addToolToStore(newTool)
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    if (disabled || draggedIndex === null || draggedIndex === dropIndex) return
    e.preventDefault()

    const newTools = [...selectedTools]
    const draggedTool = newTools[draggedIndex]

    newTools.splice(draggedIndex, 1)

    if (dropIndex === selectedTools.length) {
      newTools.push(draggedTool)
    } else {
      const adjustedDropIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex
      newTools.splice(adjustedDropIndex, 0, draggedTool)
    }

    setStoreValue(newTools)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const IconComponent = ({
    icon: Icon,
    className,
    style,
  }: {
    icon: any
    className?: string
    style?: React.CSSProperties
  }) => {
    if (!Icon) return null
    return <Icon className={className} style={style} />
  }

  // Check if tool has OAuth requirements
  const toolRequiresOAuth = (toolId: string): boolean => {
    const toolParams = getToolParametersConfig(toolId)
    return toolParams?.toolConfig?.oauth?.required || false
  }

  // Get OAuth configuration for tool
  const getToolOAuthConfig = (toolId: string) => {
    const toolParams = getToolParametersConfig(toolId)
    return toolParams?.toolConfig?.oauth
  }

  // Evaluate parameter conditions to determine if parameter should be shown
  const evaluateParameterCondition = (param: any, tool: StoredTool): boolean => {
    if (!('uiComponent' in param) || !param.uiComponent?.condition) return true

    const condition = param.uiComponent.condition
    const currentValues: Record<string, any> = {
      operation: tool.operation,
      ...tool.params,
    }

    const fieldValue = currentValues[condition.field]
    const andConditions = Array.isArray(condition.and)
      ? condition.and
      : condition.and
        ? [condition.and]
        : []

    const evaluateMatch = (
      matchCondition: {
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
      },
      valueToCheck: any
    ) => {
      const isMatch = Array.isArray(matchCondition.value)
        ? matchCondition.value.includes(valueToCheck)
        : valueToCheck === matchCondition.value
      return matchCondition.not ? !isMatch : isMatch
    }

    const baseMatch = evaluateMatch(condition, fieldValue)
    const andMatch =
      andConditions.length === 0 ||
      andConditions.every((andCondition: { field: string; value: any; not?: boolean }) =>
        evaluateMatch(andCondition, currentValues[andCondition.field])
      )

    return baseMatch && andMatch
  }

  // Render the appropriate UI component based on parameter configuration
  const renderParameterInput = (
    param: ToolParameterConfig,
    value: any,
    onChange: (value: any) => void,
    toolIndex?: number,
    currentToolParams?: Record<string, any>,
    toolId?: string
  ) => {
    // Create unique subBlockId for tool parameters to avoid conflicts
    // Use real blockId so tag dropdown and drag-drop work correctly
    const uniqueSubBlockId =
      toolIndex !== undefined
        ? `${subBlockId}-tool-${toolIndex}-${param.id}`
        : `${subBlockId}-${param.id}`
    const uiComponent = param.uiComponent

    // If no UI component info, fall back to basic input
    if (!uiComponent) {
      return (
        <ShortInput
          blockId={blockId}
          subBlockId={uniqueSubBlockId}
          placeholder={param.description}
          password={isPasswordParameter(param.id)}
          isConnecting={isConnecting}
          config={{
            id: uniqueSubBlockId,
            type: 'short-input',
            title: param.id,
          }}
          value={value}
          onChange={onChange}
        />
      )
    }

    // Render based on UI component type
    switch (uiComponent.type) {
      case 'dropdown':
        return (
          <Dropdown
            blockId={blockId}
            subBlockId={`${subBlockId}-param-${param.id}`}
            options={uiComponent.options || []}
            placeholder={uiComponent.placeholder || 'Select option'}
            useStore={false}
            valueOverride={value}
            onChange={onChange}
            disabled={disabled}
            config={{
              id: `${subBlockId}-param-${param.id}`,
              type: 'dropdown',
              dependsOn: uiComponent.dependsOn,
              fetchOptions: uiComponent.fetchOptions,
            }}
            contextValues={currentToolParams}
          />
        )

      case 'switch':
        return (
          <Switch
            checked={value === 'true' || value === 'True'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        )

      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            placeholder={uiComponent.placeholder || param.description}
            isConnecting={isConnecting}
            config={{
              id: uniqueSubBlockId,
              type: 'long-input',
              title: param.id,
            }}
            value={value}
            onChange={onChange}
          />
        )

      case 'short-input':
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            placeholder={uiComponent.placeholder || param.description}
            password={uiComponent.password || isPasswordParameter(param.id)}
            isConnecting={isConnecting}
            config={{
              id: uniqueSubBlockId,
              type: 'short-input',
              title: param.id,
            }}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        )

      case 'market-selector': {
        const providerFieldKey =
          (uiComponent as { providerFieldId?: string })?.providerFieldId || 'provider'
        const providerFieldId = `${subBlockId}-param-${providerFieldKey}`
        const providerType =
          (uiComponent as { providerType?: 'market' | 'trading' })?.providerType ||
          (toolId?.startsWith('trading_') ? 'trading' : 'market')
        const providerValueOverride =
          (currentToolParams as Record<string, any> | undefined)?.[providerFieldKey] ??
          (currentToolParams as Record<string, any> | undefined)?.provider ??
          null

        return (
          <ListingSelectorInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            value={value}
            onChange={(listing) => onChange(listing ?? null)}
            disabled={disabled}
            providerFieldId={providerFieldId}
            providerValueOverride={providerValueOverride}
            providerType={providerType}
            config={{
              id: uniqueSubBlockId,
              type: 'market-selector',
              options: uiComponent.options,
              required: param.required,
            }}
          />
        )
      }

      case 'order-id-selector':
        return (
          <OrderIdSelectorInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            value={value}
            onChange={(orderId) => onChange(orderId ?? '')}
            disabled={disabled}
            config={{
              id: uniqueSubBlockId,
              type: 'order-id-selector',
              title: uiComponent.title || formatParameterLabel(param.id),
              required: param.required,
            }}
          />
        )

      case 'channel-selector':
        return (
          <ChannelSelectorSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
            contextValues={currentToolParams as any}
          />
        )

      case 'project-selector':
        return (
          <ProjectSelectorInput
            blockId={blockId}
            subBlock={{
              id: `tool-${toolIndex || 0}-${param.id}`,
              type: 'project-selector' as const,
              title: param.id,
              provider: uiComponent.provider || 'jira',
              serviceId: uiComponent.serviceId,
              placeholder: uiComponent.placeholder,
              requiredScopes: uiComponent.requiredScopes,
            }}
            onProjectSelect={onChange}
            disabled={disabled}
          />
        )

      case 'oauth-input':
        return (
          <ToolCredentialSelector
            value={value}
            onChange={onChange}
            provider={(uiComponent.provider || uiComponent.serviceId) as OAuthProvider}
            serviceId={uiComponent.serviceId as OAuthService}
            disabled={disabled}
            requiredScopes={uiComponent.requiredScopes || []}
          />
        )

      case 'file-selector':
        return (
          <FileSelectorSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
            contextValues={currentToolParams as any}
          />
        )

      case 'table':
        return (
          <TableSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'combobox':
        return (
          <ComboboxSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
            isConnecting={isConnecting}
          />
        )

      case 'slider':
        return (
          <SliderInputSyncWrapper
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'code':
        return (
          <CodeSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
            isConnecting={isConnecting}
          />
        )

      case 'checkbox-list':
        return (
          <CheckboxListSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'time-input':
        return <TimeInputSyncWrapper value={value} onChange={onChange} disabled={disabled} />

      case 'datetime-input':
        return (
          <DateTimeInputSyncWrapper
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'file-upload':
        return (
          <FileUploadSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      default:
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            placeholder={uiComponent.placeholder || param.description}
            password={uiComponent.password || isPasswordParameter(param.id)}
            isConnecting={isConnecting}
            config={{
              id: uniqueSubBlockId,
              type: 'short-input',
              title: param.id,
            }}
            value={value}
            onChange={onChange}
          />
        )
    }
  }

  return (
    <div className='w-full'>
      {selectedTools.length === 0 ? (
        <Dropdown
          blockId={blockId}
          subBlockId={`${subBlockId}-tool-selector`}
          options={toolSelectorOptions}
          placeholder='Add Tool'
          useStore={false}
          valueOverride={toolSelectorValue}
          onChange={handleToolSelection}
          disabled={disabled}
          className='w-full'
          enableSearch
          searchPlaceholder='Search tools...'
        />
      ) : (
        <div className='flex min-h-[2.5rem] w-full flex-wrap gap-2 rounded-md border border-input bg-transparent p-2 text-sm ring-offset-background'>
          {selectedTools.map((tool, toolIndex) => {
            // Handle custom tools and MCP tools differently
            const isCustomTool = tool.type === 'custom-tool'
            const isMcpTool = tool.type === 'mcp'
            const toolBlock =
              !isCustomTool && !isMcpTool
                ? toolBlocks.find((block) => block.type === tool.type)
                : null

            // Get the current tool ID (may change based on operation)
            const currentToolId =
              !isCustomTool && !isMcpTool
                ? getToolIdForOperation(tool.type, tool.operation) || tool.toolId
                : tool.toolId

            // Get tool parameters using the new utility with block type for UI components
            const toolParams =
              !isCustomTool && !isMcpTool
                ? getToolParametersConfig(currentToolId, tool.type, tool.params)
                : null

            // For custom tools, extract parameters from schema
            const customToolParams =
              isCustomTool && tool.schema && tool.schema.function?.parameters?.properties
                ? Object.entries(tool.schema.function.parameters.properties || {}).map(
                    ([paramId, param]: [string, any]) => ({
                      id: paramId,
                      type: param.type || 'string',
                      description: param.description || '',
                      visibility: (tool.schema.function.parameters.required?.includes(paramId)
                        ? 'user-or-llm'
                        : 'user-only') as 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden',
                    })
                  )
                : []

            // For MCP tools, extract parameters from input schema
            // Use cached schema from tool object if available, otherwise fetch from mcpTools
            const mcpTool = isMcpTool ? mcpTools.find((t) => t.id === tool.toolId) : null
            const mcpToolSchema = isMcpTool ? tool.schema || mcpTool?.inputSchema : null
            const mcpToolParams =
              isMcpTool && mcpToolSchema?.properties
                ? Object.entries(mcpToolSchema.properties || {}).map(
                    ([paramId, param]: [string, any]) => ({
                      id: paramId,
                      type: param.type || 'string',
                      description: param.description || '',
                      visibility: (mcpToolSchema.required?.includes(paramId)
                        ? 'user-or-llm'
                        : 'user-only') as 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden',
                    })
                  )
                : []

            // Get all parameters to display
            const displayParams = isCustomTool
              ? customToolParams
              : isMcpTool
                ? mcpToolParams
                : toolParams?.userInputParameters || []

            // Check if tool requires OAuth
            const requiresOAuth = !isCustomTool && !isMcpTool && toolRequiresOAuth(currentToolId)
            const oauthConfig =
              !isCustomTool && !isMcpTool ? getToolOAuthConfig(currentToolId) : null

            // Tools are always expandable so users can access the interface
            const isExpandedForDisplay = !!tool.isExpanded

            return (
              <div
                key={`${tool.toolId}-${toolIndex}`}
                className={cn(
                  'group relative flex flex-col transition-all duration-200 ease-in-out',
                  'w-full',
                  draggedIndex === toolIndex ? 'scale-95 opacity-40' : '',
                  dragOverIndex === toolIndex && draggedIndex !== toolIndex && draggedIndex !== null
                    ? 'translate-y-1 transform'
                    : '',
                  selectedTools.length > 1 && !disabled ? 'cursor-grab active:cursor-grabbing' : ''
                )}
                draggable={!disabled}
                onDragStart={(e) => handleDragStart(e, toolIndex)}
                onDragOver={(e) => handleDragOver(e, toolIndex)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, toolIndex)}
              >
                <div
                  className={cn(
                    'flex flex-col overflow-visible rounded-md border bg-card',
                    dragOverIndex === toolIndex &&
                      draggedIndex !== toolIndex &&
                      draggedIndex !== null
                      ? 'border-t-2 border-t-muted-foreground/40'
                      : ''
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-between rounded-md bg-accent p-2',
                      'cursor-pointer'
                    )}
                    onClick={() => toggleToolExpansion(toolIndex)}
                  >
                    <div className='flex min-w-0 flex-shrink-1 items-center gap-2 overflow-hidden'>
                      {(() => {
                        const toolColor = isCustomTool
                          ? sanitizeSolidIconColor('#3B82F6')
                          : isMcpTool
                            ? (sanitizeSolidIconColor(mcpTool?.bgColor) ??
                              sanitizeSolidIconColor('#6366F1'))
                            : sanitizeSolidIconColor(toolBlock?.bgColor)
                        const iconColor = toolColor || 'undefined'
                        return (
                          <div
                            className='relative flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background/60 text-foreground'
                            style={{
                              backgroundColor: toolColor ? `${toolColor}20` : undefined,
                              color: toolColor ? `${toolColor}` : undefined,
                            }}
                          >
                            {isCustomTool ? (
                              <WrenchIcon className='h-3 w-3' style={{ color: iconColor }} />
                            ) : isMcpTool ? (
                              <IconComponent
                                icon={Server}
                                className='h-3 w-3'
                                style={{ color: iconColor }}
                              />
                            ) : (
                              <IconComponent
                                icon={toolBlock?.icon}
                                className='h-3 w-3'
                                style={{ color: iconColor }}
                              />
                            )}
                          </div>
                        )
                      })()}
                      <span className='truncate font-medium text-sm'>{tool.title}</span>
                    </div>
                    <div className='ml-2 flex flex-shrink-0 items-center gap-1'>
                      {/* Only render the tool usage control if the provider supports it */}
                      {supportsToolControl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Toggle
                              className='group flex h-6 items-center justify-center rounded-sm px-2 py-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=on]:bg-transparent'
                              pressed={true}
                              onPressedChange={() => {}}
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                // Cycle through the states: auto -> force -> none -> auto
                                const currentState = tool.usageControl || 'auto'
                                const nextState =
                                  currentState === 'auto'
                                    ? 'force'
                                    : currentState === 'force'
                                      ? 'none'
                                      : 'auto'
                                handleUsageControlChange(toolIndex, nextState)
                              }}
                              aria-label='Toggle tool usage control'
                            >
                              <span
                                className={`font-medium text-xs ${
                                  tool.usageControl === 'auto'
                                    ? 'block text-muted-foreground'
                                    : 'hidden'
                                }`}
                              >
                                Auto
                              </span>
                              <span
                                className={`font-medium text-xs ${tool.usageControl === 'force' ? 'block text-muted-foreground' : 'hidden'}`}
                              >
                                Force
                              </span>
                              <span
                                className={`font-medium text-xs ${tool.usageControl === 'none' ? 'block text-muted-foreground' : 'hidden'}`}
                              >
                                None
                              </span>
                            </Toggle>
                          </TooltipTrigger>
                          <TooltipContent className='max-w-[280px] p-2' side='top'>
                            <p className='text-xs'>
                              {tool.usageControl === 'auto' && (
                                <span>
                                  {' '}
                                  <span className='font-medium'> Auto:</span> The model decides when
                                  to use the tool
                                </span>
                              )}
                              {tool.usageControl === 'force' && (
                                <span>
                                  <span className='font-medium'> Force:</span> Always use this tool
                                  in the response
                                </span>
                              )}
                              {tool.usageControl === 'none' && (
                                <span>
                                  <span className='font-medium'> Deny:</span> Never use this tool
                                </span>
                              )}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTool(toolIndex)
                        }}
                        className='text-muted-foreground hover:text-foreground'
                      >
                        <XIcon className='h-4 w-4' />
                      </button>
                    </div>
                  </div>

                  {isExpandedForDisplay && (
                    <div className='space-y-3 overflow-visible p-3'>
                      {/* Operation dropdown for tools with multiple operations */}
                      {(() => {
                        const hasOperations = hasMultipleOperations(tool.type)
                        const operationOptions = hasOperations ? getOperationOptions(tool.type) : []

                        return hasOperations && operationOptions.length > 0 ? (
                          <div className='relative min-w-0 space-y-1.5'>
                            <div className='font-medium text-muted-foreground text-xs'>
                              Operation
                            </div>
                            <div className='w-full min-w-0'>
                              <Dropdown
                                blockId={blockId}
                                subBlockId={`${subBlockId}-operation-${toolIndex}`}
                                options={operationOptions}
                                placeholder='Select operation'
                                useStore={false}
                                valueOverride={tool.operation || operationOptions[0].id}
                                onChange={(value) => handleOperationChange(toolIndex, value)}
                                disabled={disabled}
                              />
                            </div>
                          </div>
                        ) : null
                      })()}

                      {/* OAuth credential selector if required */}
                      {requiresOAuth && oauthConfig && (
                        <div className='relative min-w-0 space-y-1.5'>
                          <div className='font-medium text-muted-foreground text-xs'>Account</div>
                          <div className='w-full min-w-0'>
                            <ToolCredentialSelector
                              value={tool.params.credential || ''}
                              onChange={(value) =>
                                handleParamChange(toolIndex, 'credential', value)
                              }
                              provider={oauthConfig.provider as OAuthProvider}
                              requiredScopes={oauthConfig.additionalScopes || []}
                              label={`Select ${oauthConfig.provider} account`}
                              serviceId={oauthConfig.provider}
                              disabled={disabled}
                            />
                          </div>
                        </div>
                      )}

                      {/* Tool parameters */}
                      {(() => {
                        const filteredParams = displayParams.filter((param) =>
                          evaluateParameterCondition(param, tool)
                        )
                        const groupedParams: { [key: string]: ToolParameterConfig[] } = {}
                        const standaloneParams: ToolParameterConfig[] = []

                        // Group checkbox-list parameters by their UI component title
                        filteredParams.forEach((param) => {
                          const paramConfig = param as ToolParameterConfig
                          if (
                            paramConfig.uiComponent?.type === 'checkbox-list' &&
                            paramConfig.uiComponent?.title
                          ) {
                            const groupKey = paramConfig.uiComponent.title
                            if (!groupedParams[groupKey]) {
                              groupedParams[groupKey] = []
                            }
                            groupedParams[groupKey].push(paramConfig)
                          } else {
                            standaloneParams.push(paramConfig)
                          }
                        })

                        const renderedElements: React.ReactNode[] = []

                        // Render grouped checkbox-lists
                        Object.entries(groupedParams).forEach(([groupTitle, params]) => {
                          const firstParam = params[0] as ToolParameterConfig
                          const groupValue = JSON.stringify(
                            params.reduce(
                              (acc, p) => ({ ...acc, [p.id]: tool.params[p.id] === 'true' }),
                              {}
                            )
                          )

                          renderedElements.push(
                            <div
                              key={`group-${groupTitle}`}
                              className='relative min-w-0 space-y-1.5'
                            >
                              <div className='flex items-center font-medium text-muted-foreground text-xs'>
                                {groupTitle}
                              </div>
                              <div className='relative w-full min-w-0'>
                                <CheckboxListSyncWrapper
                                  blockId={blockId}
                                  paramId={`group-${groupTitle}`}
                                  value={groupValue}
                                  onChange={(value) => {
                                    try {
                                      const parsed = JSON.parse(value)
                                      params.forEach((param) => {
                                        handleParamChange(
                                          toolIndex,
                                          param.id,
                                          parsed[param.id] ? 'true' : 'false'
                                        )
                                      })
                                    } catch {
                                      // Handle error
                                    }
                                  }}
                                  uiComponent={firstParam.uiComponent}
                                  disabled={disabled}
                                />
                              </div>
                            </div>
                          )
                        })

                        // Render standalone parameters
                        standaloneParams.forEach((param) => {
                          const hideLabel =
                            param.uiComponent?.type === 'market-selector' ||
                            param.uiComponent?.type === 'order-id-selector'
                          renderedElements.push(
                            <div key={param.id} className='relative min-w-0 space-y-1.5'>
                              {!hideLabel && (
                                <div className='flex items-center font-medium text-muted-foreground text-xs'>
                                  {param.uiComponent?.title || formatParameterLabel(param.id)}
                                  {param.required && param.visibility === 'user-only' && (
                                    <span className='ml-1 text-red-500'>*</span>
                                  )}
                                  {(!param.required || param.visibility !== 'user-only') && (
                                    <span className='ml-1 text-muted-foreground/60 text-xs'>
                                      (Optional)
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className='relative w-full min-w-0'>
                                {param.uiComponent ? (
                                  renderParameterInput(
                                    param,
                                    tool.params[param.id] || '',
                                    (value) => handleParamChange(toolIndex, param.id, value),
                                    toolIndex,
                                    {
                                      ...tool.params,
                                      ...(tool.operation ? { operation: tool.operation } : {}),
                                    },
                                    tool.toolId
                                  )
                                ) : (
                                  <ShortInput
                                    blockId={blockId}
                                    subBlockId={`${subBlockId}-tool-${toolIndex}-${param.id}`}
                                    placeholder={param.description}
                                    password={isPasswordParameter(param.id)}
                                    isConnecting={isConnecting}
                                    config={{
                                      id: `${subBlockId}-tool-${toolIndex}-${param.id}`,
                                      type: 'short-input',
                                      title: param.id,
                                    }}
                                    value={tool.params[param.id] || ''}
                                    onChange={(value) =>
                                      handleParamChange(toolIndex, param.id, value)
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          )
                        })

                        return renderedElements
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Drop zone for the end of the list */}
          {selectedTools.length > 0 && draggedIndex !== null && (
            <div
              className={cn(
                'h-2 w-full rounded transition-all duration-200 ease-in-out',
                dragOverIndex === selectedTools.length
                  ? 'border-b-2 border-b-muted-foreground/40'
                  : ''
              )}
              onDragOver={(e) => handleDragOver(e, selectedTools.length)}
              onDrop={(e) => handleDrop(e, selectedTools.length)}
            />
          )}

          <Dropdown
            blockId={blockId}
            subBlockId={`${subBlockId}-tool-selector-inline`}
            options={toolSelectorOptions}
            placeholder='Add Tool'
            useStore={false}
            valueOverride={toolSelectorValue}
            onChange={handleToolSelection}
            disabled={disabled}
            className='w-full'
            enableSearch
            searchPlaceholder='Search tools...'
          />
        </div>
      )}
    </div>
  )
}
