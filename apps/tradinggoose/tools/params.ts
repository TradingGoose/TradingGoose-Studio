import { createLogger } from '@/lib/logs/console/logger'
import type {
  BlockConfig,
  SubBlockCondition as ComponentCondition,
  SubBlockConfig,
  SubBlockOption,
} from '@/blocks/types'
import type { TradingProviderParamDefinition } from '@/providers/trading/providers'
import {
  getTradingProviderParamCatalog,
  getTradingProviderParamDefinitions,
} from '@/providers/trading/providers'
import type { ParameterVisibility, ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const logger = createLogger('ToolsParams')

export type UIComponentConfig = Omit<
  Partial<SubBlockConfig>,
  'acceptedTypes' | 'condition' | 'dependsOn' | 'id' | 'options' | 'type' | 'value'
> & {
  type: SubBlockConfig['type'] | string
  subBlockId?: string
  options?: SubBlockOption[]
  condition?: ComponentCondition
  value?: unknown
  acceptedTypes?: string | string[]
  dependsOn?: string[]
}

export interface SchemaProperty {
  type: string
  description: string
}

export interface ToolSchema {
  type: 'object'
  properties: Record<string, SchemaProperty>
  required: string[]
}

export interface ValidationResult {
  valid: boolean
  missingParams: string[]
}

export interface ToolParameterConfig {
  id: string
  type: string
  required?: boolean // Required for tool execution
  visibility?: ParameterVisibility // Controls who can/must provide this parameter
  userProvided?: boolean // User filled this parameter
  description?: string
  default?: unknown
  // UI component information from block config
  uiComponent?: UIComponentConfig
}

export interface ToolWithParameters {
  toolConfig: ToolConfig
  allParameters: ToolParameterConfig[]
  userInputParameters: ToolParameterConfig[] // Parameters shown to user
  requiredParameters: ToolParameterConfig[] // Must be filled by user or LLM
  optionalParameters: ToolParameterConfig[] // Nice to have, shown to user
}

const resolveProviderInputType = (
  definition: TradingProviderParamDefinition
): UIComponentConfig['type'] => {
  if (definition.inputType) return definition.inputType
  if (definition.options?.length) return 'dropdown'

  switch (definition.type) {
    case 'boolean':
      return 'switch'
    case 'json':
    case 'array':
      return 'code'
    case 'number':
      return 'short-input'
    default:
      return 'short-input'
  }
}

const normalizeConditionList = (
  condition?: ComponentCondition | ComponentCondition[]
): ComponentCondition[] => {
  if (!condition) return []
  return Array.isArray(condition) ? condition : [condition]
}

const combineConditions = (
  base?: ComponentCondition,
  extra?: ComponentCondition | ComponentCondition[]
): ComponentCondition | undefined => {
  if (!base) return extra as ComponentCondition | undefined
  if (!extra) return base

  const baseAnd = normalizeConditionList(base.and)
  const extraList = normalizeConditionList(extra)

  return {
    ...base,
    and: [...baseAnd, ...extraList],
  }
}

const buildProviderUiComponent = (
  definition: TradingProviderParamDefinition,
  condition?: ComponentCondition
): UIComponentConfig => ({
  type: resolveProviderInputType(definition),
  options: definition.options?.map((option) => ({ id: option.id, label: option.label })),
  placeholder: definition.placeholder,
  password: definition.password,
  title: definition.title,
  layout: definition.layout,
  min: definition.min,
  max: definition.max,
  step: definition.step,
  integer: definition.integer,
  rows: definition.rows,
  dependsOn: definition.dependsOn,
  fetchOptions: definition.fetchOptions,
  condition,
  inputType: definition.type === 'number' ? 'number' : undefined,
})

const getCanonicalSubBlockParamId = (subBlock: SubBlockConfig): string =>
  subBlock.canonicalParamId ?? subBlock.id

const resolveSubBlockCondition = (
  condition: SubBlockConfig['condition']
): ComponentCondition | undefined => (typeof condition === 'function' ? condition() : condition)

const resolveSubBlockOptions = (options: SubBlockConfig['options']) =>
  typeof options === 'function' ? options() : options

const resolveDependsOn = (dependsOn: SubBlockConfig['dependsOn']): string[] | undefined => {
  if (Array.isArray(dependsOn)) return dependsOn
  return dependsOn?.all ?? dependsOn?.any
}

const matchesConditionValue = (condition: ComponentCondition, value?: string): boolean => {
  if (!value) return false
  return Array.isArray(condition.value)
    ? condition.value.includes(value)
    : condition.value === value
}

const getOperationIdForTool = (blockConfig: BlockConfig, toolId: string): string | undefined => {
  const operationSubBlock = blockConfig.subBlocks.find((subBlock) => subBlock.id === 'operation')
  const operationOptions = resolveSubBlockOptions(operationSubBlock?.options)
  if (!Array.isArray(operationOptions)) return undefined

  return operationOptions.find((option) => {
    const configuredToolId = blockConfig.tools.config?.tool({ operation: option.id })
    return configuredToolId === toolId || option.id === toolId
  })?.id
}

/**
 * Gets all parameters for a tool, categorized by their usage
 * Also includes UI component information from block configurations
 */
export function getToolParametersConfig(
  toolId: string,
  blockConfig?: BlockConfig,
  contextValues?: Record<string, any>
): ToolWithParameters | null {
  try {
    const toolConfig = getTool(toolId)
    if (!toolConfig) {
      logger.warn(`Tool not found: ${toolId}`)
      return null
    }

    // Validate that toolConfig has required properties
    if (!toolConfig.params || typeof toolConfig.params !== 'object') {
      logger.warn(`Tool ${toolId} has invalid params configuration`)
      return null
    }

    const tradingProviderContext = (() => {
      if (toolId !== 'trading_place_order') return null

      const providerId = contextValues?.provider as string | undefined
      const providerDefinitions = providerId
        ? getTradingProviderParamDefinitions(providerId, 'order')
        : []
      const providerCatalog = getTradingProviderParamCatalog('order')

      return {
        providerId,
        providerDefinitions,
        providerCatalog,
      }
    })()

    const baseParamEntries = Object.entries(toolConfig.params)
    let orderedParamEntries = baseParamEntries

    if (tradingProviderContext?.providerDefinitions?.length) {
      const baseParamIds = baseParamEntries.map(([paramId]) => paramId)
      const providerParamIds = tradingProviderContext.providerDefinitions
        .map((definition) => definition.id)
        .filter((paramId) => baseParamIds.includes(paramId))

      if (providerParamIds.length > 0) {
        const providerOrder = tradingProviderContext.providerDefinitions
          .filter((definition) => providerParamIds.includes(definition.id))
          .map((definition, index) => ({
            id: definition.id,
            displayOrder: definition.displayOrder,
            providerIndex: index,
          }))
          .sort((a, b) => {
            const aHasOrder = typeof a.displayOrder === 'number'
            const bHasOrder = typeof b.displayOrder === 'number'
            if (aHasOrder && bHasOrder && a.displayOrder !== b.displayOrder) {
              return (a.displayOrder as number) - (b.displayOrder as number)
            }
            if (aHasOrder && !bHasOrder) return -1
            if (!aHasOrder && bHasOrder) return 1
            return a.providerIndex - b.providerIndex
          })
          .map((entry) => entry.id)

        const firstProviderIndex = baseParamIds.findIndex((paramId) =>
          providerParamIds.includes(paramId)
        )

        if (firstProviderIndex >= 0) {
          const remainingIds = baseParamIds.filter((paramId) => !providerParamIds.includes(paramId))
          const reorderedIds = [
            ...remainingIds.slice(0, firstProviderIndex),
            ...providerOrder,
            ...remainingIds.slice(firstProviderIndex),
          ]
          const entryMap = new Map(baseParamEntries)
          orderedParamEntries = reorderedIds
            .map((paramId) => {
              const entry = entryMap.get(paramId)
              return entry ? [paramId, entry] : undefined
            })
            .filter(Boolean) as Array<[string, any]>
        }
      }
    }

    // Convert tool params to our standard format with UI component info
    const allParameters: ToolParameterConfig[] = orderedParamEntries.map(([paramId, param]) => {
      const toolParam: ToolParameterConfig = {
        id: paramId,
        type: param.type,
        required: param.required ?? false,
        visibility: param.visibility ?? (param.required ? 'user-or-llm' : 'user-only'),
        description: param.description,
        default: param.default,
      }

      // Add UI component information from block config if available
      if (blockConfig) {
        // For multi-operation tools, find the subblock that matches both the parameter ID
        // and the current tool operation
        let subBlock = blockConfig.subBlocks?.find((sb: SubBlockConfig) => {
          if (getCanonicalSubBlockParamId(sb) !== paramId) return false

          const condition = resolveSubBlockCondition(sb.condition)
          if (!condition || condition.field !== 'operation') return true

          return (
            matchesConditionValue(condition, toolId) ||
            matchesConditionValue(condition, getOperationIdForTool(blockConfig, toolId))
          )
        })

        // Special case: Check if this boolean parameter is part of a checkbox-list
        if (!subBlock && param.type === 'boolean' && blockConfig) {
          // Look for a checkbox-list that includes this parameter as an option
          const checkboxListBlock = blockConfig.subBlocks?.find((sb: SubBlockConfig) => {
            const options = resolveSubBlockOptions(sb.options)
            return (
              sb.type === 'checkbox-list' &&
              Array.isArray(options) &&
              options.some((opt: any) => opt.id === paramId)
            )
          })

          if (checkboxListBlock) {
            subBlock = checkboxListBlock
          }
        }

        if (subBlock) {
          toolParam.uiComponent = {
            type: subBlock.type,
            subBlockId: subBlock.id,
            options: resolveSubBlockOptions(subBlock.options),
            placeholder: subBlock.placeholder,
            description: subBlock.description,
            tooltip: subBlock.tooltip,
            password: subBlock.password,
            condition: resolveSubBlockCondition(subBlock.condition),
            title: subBlock.title,
            layout: subBlock.layout,
            value: subBlock.value,
            provider: subBlock.provider,
            serviceId: subBlock.serviceId,
            requiredScopes: subBlock.requiredScopes,
            providerType: subBlock.providerType,
            providerFieldId: subBlock.providerFieldId,
            enableSearch: subBlock.enableSearch,
            searchPlaceholder: subBlock.searchPlaceholder,
            mimeType: subBlock.mimeType,
            columns: subBlock.columns,
            min: subBlock.min,
            max: subBlock.max,
            step: subBlock.step,
            integer: subBlock.integer,
            format: subBlock.format,
            timezone: subBlock.timezone,
            clearable: subBlock.clearable,
            hideCalendarIcon: subBlock.hideCalendarIcon,
            language: subBlock.language,
            generationType: subBlock.generationType,
            acceptedTypes: subBlock.acceptedTypes,
            multiple: subBlock.multiple,
            maxSize: subBlock.maxSize,
            autoSelectFirstOption: subBlock.autoSelectFirstOption,
            dependsOn: resolveDependsOn(subBlock.dependsOn),
            fetchOptions: subBlock.fetchOptions,
          }
        }
      }

      if (tradingProviderContext?.providerCatalog) {
        const providerDefinitions = tradingProviderContext.providerDefinitions ?? []
        const providerDefinition = providerDefinitions.find(
          (definition) => definition.id === paramId
        )
        const registryEntry = tradingProviderContext.providerCatalog.registry[paramId]
        const providerCondition =
          registryEntry?.providers?.length > 0
            ? ({
                field: 'provider',
                value: registryEntry.providers,
              } as ComponentCondition)
            : undefined
        const definitionCondition = providerDefinition?.condition as ComponentCondition | undefined
        const mergedCondition = combineConditions(definitionCondition, providerCondition)

        if (providerDefinition) {
          toolParam.description = providerDefinition.description || toolParam.description
          if (providerDefinition.defaultValue !== undefined) {
            toolParam.default = providerDefinition.defaultValue
          }
        }

        if (!toolParam.uiComponent && (providerDefinition || providerCondition)) {
          const baseDefinition =
            providerDefinition ??
            ({
              id: paramId,
              type: param.type,
              title: undefined,
              description: toolParam.description,
              placeholder: undefined,
              required: param.required,
              visibility: param.visibility,
            } as TradingProviderParamDefinition)

          toolParam.uiComponent = buildProviderUiComponent(baseDefinition, mergedCondition)
        } else if (toolParam.uiComponent && mergedCondition) {
          toolParam.uiComponent.condition = combineConditions(
            mergedCondition,
            toolParam.uiComponent.condition
          )
        }
      }

      return toolParam
    })

    // Parameters that should be shown to the user for input
    const userInputParameters = allParameters.filter(
      (param) => param.visibility === 'user-or-llm' || param.visibility === 'user-only'
    )

    // Parameters that are required (must be filled by user or LLM)
    const requiredParameters = allParameters.filter((param) => param.required)

    // Parameters that are optional but can be provided by user
    const optionalParameters = allParameters.filter(
      (param) => param.visibility === 'user-only' && !param.required
    )

    return {
      toolConfig,
      allParameters,
      userInputParameters,
      requiredParameters,
      optionalParameters,
    }
  } catch (error) {
    logger.error('Error getting tool parameters config:', error)
    return null
  }
}

export function getRenderableToolParameters(
  parameters: ToolParameterConfig[]
): ToolParameterConfig[] {
  const renderedCheckboxLists = new Set<string>()

  return parameters.filter((param) => {
    const uiComponent = param.uiComponent
    if (uiComponent?.type !== 'checkbox-list' || !uiComponent.subBlockId) return true

    const condition = uiComponent.condition
    const conditionValue = Array.isArray(condition?.value)
      ? condition.value.join('|')
      : String(condition?.value ?? '')
    const renderKey = [
      uiComponent.subBlockId,
      condition?.field ?? '',
      conditionValue,
      condition?.not ? 'not' : '',
    ].join(':')

    if (renderedCheckboxLists.has(renderKey)) return false
    renderedCheckboxLists.add(renderKey)
    return true
  })
}

/**
 * Creates a tool schema for LLM with user-provided parameters excluded
 */
export function createLLMToolSchema(
  toolConfig: ToolConfig,
  userProvidedParams: Record<string, unknown>
): ToolSchema {
  const schema: ToolSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  // Only include parameters that the LLM should/can provide
  Object.entries(toolConfig.params).forEach(([paramId, param]) => {
    const isUserProvided =
      userProvidedParams[paramId] !== undefined &&
      userProvidedParams[paramId] !== null &&
      userProvidedParams[paramId] !== ''

    // Skip parameters that user has already provided
    if (isUserProvided) {
      return
    }

    // Skip parameters that are user-only (never shown to LLM)
    if (param.visibility === 'user-only') {
      return
    }

    // Skip hidden parameters
    if (param.visibility === 'hidden') {
      return
    }

    // Add parameter to LLM schema
    let schemaType = param.type
    if (param.type === 'json' || param.type === 'any') {
      schemaType = 'object'
    }

    schema.properties[paramId] = {
      type: schemaType,
      description: param.description || '',
    }

    // Add to required if LLM must provide it and it's originally required
    if ((param.visibility === 'user-or-llm' || param.visibility === 'llm-only') && param.required) {
      schema.required.push(paramId)
    }
  })

  return schema
}

/**
 * Creates a complete tool schema for execution with all parameters
 */
export function createExecutionToolSchema(toolConfig: ToolConfig): ToolSchema {
  const schema: ToolSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  Object.entries(toolConfig.params).forEach(([paramId, param]) => {
    schema.properties[paramId] = {
      type: param.type === 'json' ? 'object' : param.type,
      description: param.description || '',
    }

    if (param.required) {
      schema.required.push(paramId)
    }
  })

  return schema
}

/**
 * Merges user-provided parameters with LLM-generated parameters
 */
export function mergeToolParameters(
  userProvidedParams: Record<string, unknown>,
  llmGeneratedParams: Record<string, unknown>
): Record<string, unknown> {
  // User-provided parameters take precedence
  return {
    ...llmGeneratedParams,
    ...userProvidedParams,
  }
}

/**
 * Filters out user-provided parameters from tool schema for LLM
 */
export function filterSchemaForLLM(
  originalSchema: ToolSchema,
  userProvidedParams: Record<string, unknown>
): ToolSchema {
  if (!originalSchema || !originalSchema.properties) {
    return originalSchema
  }

  const filteredProperties = { ...originalSchema.properties }
  const filteredRequired = [...(originalSchema.required || [])]

  // Remove user-provided parameters from the schema
  Object.keys(userProvidedParams).forEach((paramKey) => {
    if (
      userProvidedParams[paramKey] !== undefined &&
      userProvidedParams[paramKey] !== null &&
      userProvidedParams[paramKey] !== ''
    ) {
      delete filteredProperties[paramKey]
      const reqIndex = filteredRequired.indexOf(paramKey)
      if (reqIndex > -1) {
        filteredRequired.splice(reqIndex, 1)
      }
    }
  })

  return {
    ...originalSchema,
    properties: filteredProperties,
    required: filteredRequired,
  }
}

/**
 * Validates that all required parameters are provided
 */
export function validateToolParameters(
  toolConfig: ToolConfig,
  finalParams: Record<string, unknown>
): ValidationResult {
  const requiredParams = Object.entries(toolConfig.params)
    .filter(([_, param]) => param.required)
    .map(([paramId]) => paramId)

  const missingParams = requiredParams.filter(
    (paramId) =>
      finalParams[paramId] === undefined ||
      finalParams[paramId] === null ||
      finalParams[paramId] === ''
  )

  return {
    valid: missingParams.length === 0,
    missingParams,
  }
}

/**
 * Helper to check if a parameter should be treated as a password field
 */
export function isPasswordParameter(paramId: string): boolean {
  const passwordFields = [
    'password',
    'apiKey',
    'token',
    'secret',
    'key',
    'credential',
    'accessToken',
    'refreshToken',
    'botToken',
    'authToken',
  ]

  return passwordFields.some((field) => paramId.toLowerCase().includes(field.toLowerCase()))
}

/**
 * Formats parameter IDs into human-readable labels
 */
export function formatParameterLabel(paramId: string): string {
  // Special cases
  if (paramId === 'apiKey') return 'API Key'
  if (paramId === 'apiVersion') return 'API Version'
  if (paramId === 'accessToken') return 'Access Token'
  if (paramId === 'refreshToken') return 'Refresh Token'
  if (paramId === 'botToken') return 'Bot Token'

  // Handle underscore and hyphen separated words
  if (paramId.includes('_') || paramId.includes('-')) {
    return paramId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Handle single character parameters
  if (paramId.length === 1) return paramId.toUpperCase()

  // Handle camelCase
  if (/[A-Z]/.test(paramId)) {
    const result = paramId.replace(/([A-Z])/g, ' $1')
    return (
      result.charAt(0).toUpperCase() +
      result
        .slice(1)
        .replace(/ Api/g, ' API')
        .replace(/ Id/g, ' ID')
        .replace(/ Url/g, ' URL')
        .replace(/ Uri/g, ' URI')
        .replace(/ Ui/g, ' UI')
    )
  }

  // Simple case - just capitalize first letter
  return paramId.charAt(0).toUpperCase() + paramId.slice(1)
}
