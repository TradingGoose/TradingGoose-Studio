import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { isEqual } from 'lodash'
import { Server, WrenchIcon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import type { OAuthProvider } from '@/lib/oauth/oauth'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import {
  getProviderIdsForBlocks,
  isBlockAvailable,
  type ProviderAvailability,
} from '@/lib/workflows/block-availability'
import { useWorkflowMutations } from '@/lib/yjs/use-workflow-doc'
import { getAllBlocks } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/ai/utils'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import {
  formatParameterLabel,
  getRenderableToolParameters,
  getToolParametersConfig,
  isPasswordParameter,
  type ToolParameterConfig,
} from '@/tools/params'
import { Dropdown } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components'
import { ToolCredentialSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector'
import { ToolSubBlockRenderer } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tools/sub-block-renderer'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

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
  params: Record<string, any>
  isExpanded?: boolean
  schema?: any // For custom tools
  code?: string // For custom tools implementation
  operation?: string // For tools with multiple operations
  usageControl?: 'auto' | 'force' | 'none'
}

export function ToolInput({ blockId, subBlockId, isConnecting, disabled = false }: ToolInputProps) {
  const workspaceId = useWorkspaceId()
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

  const allToolBlocks = useMemo(
    () =>
      getAllBlocks().filter((block) => block.category === 'tools' && block.type !== 'evaluator'),
    []
  )

  const [providerAvailability, setProviderAvailability] = useState<ProviderAvailability>({})

  useEffect(() => {
    let isMounted = true
    const providerIds = getProviderIdsForBlocks(allToolBlocks)
    if (providerIds.length === 0) return

    const loadAvailability = async () => {
      try {
        const query = `?providers=${encodeURIComponent(providerIds.join(','))}`
        const response = await fetch(`/api/auth/oauth/providers${query}`, {
          cache: 'no-store',
        })
        if (!response.ok || !isMounted) return
        const data = (await response.json()) as ProviderAvailability
        if (isMounted) setProviderAvailability(data)
      } catch {
        // Keep default availability on failure
      }
    }

    void loadAvailability()
    return () => {
      isMounted = false
    }
  }, [allToolBlocks])

  const toolBlocks = useMemo(
    () => allToolBlocks.filter((block) => isBlockAvailable(block, providerAvailability)),
    [allToolBlocks, providerAvailability]
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
    }> = [
      {
        id: 'action:add-mcp',
        label: 'Create MCP Server',
        icon: Server,
        group: 'Actions',
      },
    ]

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

    // Use tool access ids when the block has no operation dropdown.
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
    const toolParams = getToolParametersConfig(toolId, toolBlock)
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

    const newTool: StoredTool = {
      type: 'custom-tool',
      title: customTool.title,
      toolId: `custom_${customTool.id}`,
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
    if (isEqual(currentValue, paramValue)) {
      return
    }

    const dependentParamIds = (() => {
      const toolBlock = allToolBlocks.find((block) => block.type === tool.type)
      const toolParams = getToolParametersConfig(tool.toolId, toolBlock, tool.params)
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
    const toolBlock = allToolBlocks.find((block) => block.type === tool.type)
    const toolParams = getToolParametersConfig(newToolId, toolBlock, tool.params)

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
              params: { ...initialParams, ...preservedParams },
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

  // Tool parameters render through the same SubBlock path as first-class block fields.
  const renderParameterInput = (
    param: ToolParameterConfig,
    toolIndex: number,
    currentToolParams: Record<string, any>,
    toolId: string
  ) => {
    const uiComponent = param.uiComponent
    const mapDependencyId = (paramId: string) => `${subBlockId}-tool-${toolIndex}-${paramId}`
    const providerFieldId = mapDependencyId(uiComponent?.providerFieldId || 'provider')
    const providerType =
      uiComponent?.providerType || (toolId?.startsWith('trading_') ? 'trading' : 'market')
    const subBlock: SubBlockConfig = {
      id: param.id,
      type: (uiComponent?.type || 'short-input') as SubBlockConfig['type'],
      title: uiComponent?.title || formatParameterLabel(param.id),
      canonicalParamId: param.id,
      options: uiComponent?.options,
      placeholder: uiComponent?.placeholder || param.description,
      description: uiComponent?.description,
      tooltip: uiComponent?.tooltip,
      required: param.required,
      password: uiComponent?.password || isPasswordParameter(param.id),
      inputType: uiComponent?.inputType,
      provider: uiComponent?.provider,
      serviceId: uiComponent?.serviceId,
      requiredScopes: uiComponent?.requiredScopes,
      providerType,
      providerFieldId,
      enableSearch: uiComponent?.enableSearch,
      searchPlaceholder: uiComponent?.searchPlaceholder,
      mimeType: uiComponent?.mimeType,
      columns: uiComponent?.columns,
      min: uiComponent?.min,
      max: uiComponent?.max,
      step: uiComponent?.step,
      integer: uiComponent?.integer,
      rows: uiComponent?.rows,
      timezone: uiComponent?.timezone,
      clearable: uiComponent?.clearable,
      hideCalendarIcon: uiComponent?.hideCalendarIcon,
      minDate: uiComponent?.minDate,
      maxDate: uiComponent?.maxDate,
      hideTime: uiComponent?.hideTime,
      use12HourFormat: uiComponent?.use12HourFormat,
      timePicker: uiComponent?.timePicker,
      language: uiComponent?.language as SubBlockConfig['language'],
      generationType: uiComponent?.generationType as SubBlockConfig['generationType'],
      acceptedTypes: Array.isArray(uiComponent?.acceptedTypes)
        ? uiComponent.acceptedTypes.join(',')
        : uiComponent?.acceptedTypes,
      multiple: uiComponent?.multiple,
      maxSize: uiComponent?.maxSize,
      autoSelectFirstOption: uiComponent?.autoSelectFirstOption,
      value: uiComponent?.value as SubBlockConfig['value'],
      dependsOn: uiComponent?.dependsOn?.map(mapDependencyId),
      fetchOptions: uiComponent?.fetchOptions
        ? async (blockId, subBlockId, context) =>
            uiComponent.fetchOptions?.(blockId, subBlockId, {
              ...context,
              contextValues: currentToolParams,
            } as any) ?? []
        : undefined,
    }

    return (
      <ToolSubBlockRenderer
        blockId={blockId}
        subBlockId={subBlockId}
        toolIndex={toolIndex}
        subBlock={subBlock}
        effectiveParamId={param.id}
        toolParams={currentToolParams}
        onParamChange={handleParamChange}
        isConnecting={isConnecting}
        disabled={disabled}
      />
    )
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
                ? getToolParametersConfig(currentToolId, toolBlock ?? undefined, tool.params)
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
            const displayToolTitle =
              isCustomTool || isMcpTool ? tool.title : (toolBlock?.name ?? tool.title)

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
                      <span className='truncate font-medium text-sm'>{displayToolTitle}</span>
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
                      {getRenderableToolParameters(displayParams)
                        .filter((param) => evaluateParameterCondition(param, tool))
                        .map((param) => {
                          const currentToolParams = {
                            ...tool.params,
                            ...(tool.operation ? { operation: tool.operation } : {}),
                          }
                          return (
                            <div key={param.id} className='relative min-w-0 space-y-1.5'>
                              <div className='relative w-full min-w-0'>
                                {renderParameterInput(
                                  param,
                                  toolIndex,
                                  currentToolParams,
                                  currentToolId
                                )}
                              </div>
                            </div>
                          )
                        })}
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
