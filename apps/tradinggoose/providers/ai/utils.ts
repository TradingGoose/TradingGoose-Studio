import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import {
  buildCustomToolModelDescription,
  createCustomToolRuntimeId,
  isCustomToolRuntimeId,
} from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionSubmissionSource } from '@/executor/types'
import { getModelCapabilities, getModelPricing } from '@/providers/ai/models'
import type { ProviderResponse, ProviderToolConfig } from '@/providers/ai/types'
import { useCustomToolsStore } from '@/stores/custom-tools/store'

const logger = createLogger('ProviderUtils')

/**
 * Transforms a custom tool schema into a provider tool config
 */
export function transformCustomTool(customTool: any): ProviderToolConfig {
  const schema = customTool.schema

  if (!schema || !schema.function) {
    throw new Error('Invalid custom tool schema')
  }

  const toolId = createCustomToolRuntimeId(customTool.id)
  return {
    id: toolId,
    name: customTool.title.trim(),
    description: buildCustomToolModelDescription({
      title: customTool.title,
      description: schema.function.description,
    }),
    params: {}, // This will be derived from parameters
    parameters: {
      type: schema.function.parameters.type,
      properties: schema.function.parameters.properties,
      required: schema.function.parameters.required || [],
    },
  }
}

/**
 * Gets all available custom tools as provider tool configs
 */
export function getCustomTools(workspaceId?: string): ProviderToolConfig[] {
  // Get custom tools from the store
  const customTools = useCustomToolsStore.getState().getAllTools(workspaceId)

  // Transform each custom tool into a provider tool config
  return customTools.map(transformCustomTool)
}

/**
 * Transforms a block tool into a provider tool config with operation selection
 *
 * @param block The block to transform
 * @param options Additional options including dependencies and selected operation
 * @returns The provider tool config or null if transform fails
 */
export async function transformBlockTool(
  block: any,
  options: {
    selectedOperation?: string
    getAllBlocks: () => any[]
    getTool: (toolId: string) => any
    getToolAsync?: (toolId: string) => Promise<any>
    createLLMToolSchema: (toolConfig: any, userProvidedParams: Record<string, unknown>) => any
  }
): Promise<ProviderToolConfig | null> {
  const { selectedOperation, getAllBlocks, getTool, getToolAsync, createLLMToolSchema } = options

  // Get the block definition
  const blockDef = getAllBlocks().find((b: any) => b.type === block.type)
  if (!blockDef) {
    logger.warn(`Block definition not found for type: ${block.type}`)
    return null
  }

  // If the block has multiple operations, use the selected one or the first one
  let toolId: string | null = null

  if ((blockDef.tools?.access?.length || 0) > 1) {
    // If we have an operation dropdown in the block and a selected operation
    if (selectedOperation && blockDef.tools?.config?.tool) {
      // Use the block's tool selection function to get the right tool
      try {
        toolId = blockDef.tools.config.tool({
          ...block.params,
          operation: selectedOperation,
        })
      } catch (error) {
        logger.error('Error selecting tool for block', {
          blockType: block.type,
          operation: selectedOperation,
          error,
        })
        return null
      }
    } else {
      // Default to first tool if no operation specified
      toolId = blockDef.tools.access[0]
    }
  } else {
    // Single tool case
    toolId = blockDef.tools?.access?.[0] || null
  }

  if (!toolId) {
    logger.warn(`No tool ID found for block: ${block.type}`)
    return null
  }

  // Get the tool config - check if it's a custom tool that needs async fetching
  let toolConfig: any

  if (isCustomToolRuntimeId(toolId) && getToolAsync) {
    // Use the async version for custom tools
    toolConfig = await getToolAsync(toolId)
  } else {
    // Use the synchronous version for built-in tools
    toolConfig = getTool(toolId)
  }

  if (!toolConfig) {
    logger.warn(`Tool config not found for ID: ${toolId}`)
    return null
  }

  // Get user-provided parameters from the block
  const userProvidedParams = block.params || {}

  // Create LLM schema that excludes user-provided parameters
  const llmSchema = createLLMToolSchema(toolConfig, userProvidedParams)

  // Return formatted tool config
  return {
    id: toolConfig.id,
    name: toolConfig.name,
    description: toolConfig.description,
    params: userProvidedParams,
    parameters: llmSchema,
  }
}

/**
 * Calculate cost for token usage based on model pricing
 *
 * @param model The model name
 * @param promptTokens Number of prompt tokens used
 * @param completionTokens Number of completion tokens used
 * @param useCachedInput Whether to use cached input pricing (default: false)
 * @returns Cost calculation results with input, output and total costs
 */
export function calculateCost(
  model: string,
  promptTokens = 0,
  completionTokens = 0,
  useCachedInput = false
) {
  let pricing = getModelPricing(model)

  if (!pricing) {
    return {
      input: 0,
      output: 0,
      total: 0,
      pricing: null,
    }
  }

  const tier = pricing.tiers
    ?.slice()
    .reverse()
    .find(({ aboveInputTokens }) => promptTokens > aboveInputTokens)
  if (tier) {
    pricing = {
      ...pricing,
      input: tier.input,
      cachedInput: tier.cachedInput,
      output: tier.output,
    }
  }

  // Calculate costs in USD
  // Convert from "per million tokens" to "per token" by dividing by 1,000,000
  const inputCost =
    promptTokens *
    (useCachedInput && pricing.cachedInput !== undefined
      ? pricing.cachedInput / 1_000_000
      : pricing.input / 1_000_000)

  const outputCost = completionTokens * (pricing.output / 1_000_000)
  return {
    input: Number.parseFloat(inputCost.toFixed(8)),
    output: Number.parseFloat(outputCost.toFixed(8)),
    total: Number.parseFloat((inputCost + outputCost).toFixed(8)),
    pricing,
  }
}

export function createModelCost(model: string, useCachedInput = false) {
  const value = calculateCost(model)
  return {
    value,
    add(input: number, output: number) {
      const cost = calculateCost(model, input, output, useCachedInput)
      value.input += cost.input
      value.output += cost.output
      value.total += cost.total
      value.pricing = cost.pricing
      return value
    },
  }
}

export function withToolCosts(
  cost: ProviderResponse['cost'],
  toolResults?: Record<string, unknown>[]
): ProviderResponse['cost'] {
  let toolCost = 0
  for (const result of toolResults ?? []) {
    const total = (result.cost as { total?: unknown } | undefined)?.total
    if (typeof total === 'number') toolCost += total
  }
  return { ...cost, toolCost: toolCost || undefined, total: cost.input + cost.output + toolCost }
}

/**
 * Format cost as a currency string
 *
 * @param cost Cost in USD
 * @returns Formatted cost string
 */
export function formatCost(cost: number): string {
  if (cost === undefined || cost === null) return '—'

  if (cost >= 1) {
    return `$${cost.toFixed(2)}`
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(3)}`
  }
  if (cost >= 0.001) {
    return `$${cost.toFixed(4)}`
  }
  if (cost > 0) {
    const places = Math.max(4, Math.abs(Math.floor(Math.log10(cost))) + 3)
    return `$${cost.toFixed(places)}`
  }
  return '$0'
}

/**
 * Prepares tool configuration for provider requests with consistent tool usage control behavior
 *
 * @param tools Array of tools in provider-specific format
 * @param providerTools Original tool configurations with usage control settings
 * @param logger Logger instance to use for logging
 * @param provider Optional provider ID to adjust format for specific providers
 * @returns Object with prepared tools and tool_choice settings
 */
export function prepareToolsWithUsageControl(
  tools: any[] | undefined,
  providerTools: any[] | undefined,
  logger: any,
  provider?: string,
  supportsForcedTools = true
): {
  tools: any[] | undefined
  toolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } }
    | undefined
  toolConfig?: {
    // Add toolConfig for Google's format
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE'
      allowedFunctionNames?: string[]
    }
  }
  hasFilteredTools: boolean
  forcedTools: string[] // Return all forced tool IDs
} {
  // If no tools, return early
  if (!tools || tools.length === 0) {
    return {
      tools: undefined,
      toolChoice: undefined,
      hasFilteredTools: false,
      forcedTools: [],
    }
  }

  // Filter out tools marked with usageControl='none'
  const filteredTools = tools.filter((tool) => {
    const toolId = tool.function?.name || tool.name
    const toolConfig = providerTools?.find((t) => t.id === toolId)
    return toolConfig?.usageControl !== 'none'
  })

  // Check if any tools were filtered out
  const hasFilteredTools = filteredTools.length < tools.length
  if (hasFilteredTools) {
    logger.info(
      `Filtered out ${tools.length - filteredTools.length} tools with usageControl='none'`
    )
  }

  // If all tools were filtered out, return empty
  if (filteredTools.length === 0) {
    logger.info('All tools were filtered out due to usageControl="none"')
    return {
      tools: undefined,
      toolChoice: undefined,
      hasFilteredTools: true,
      forcedTools: [],
    }
  }

  // Get all tools that should be forced
  const forcedTools = supportsForcedTools
    ? providerTools?.filter((tool) => tool.usageControl === 'force') || []
    : []
  const forcedToolIds = forcedTools.map((tool) => tool.id)

  // Determine tool_choice setting
  let toolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } } = 'auto'

  // For Google, we'll use a separate toolConfig object
  let toolConfig:
    | {
        functionCallingConfig: {
          mode: 'AUTO' | 'ANY' | 'NONE'
          allowedFunctionNames?: string[]
        }
      }
    | undefined

  if (forcedTools.length > 0) {
    // Force the first tool that has usageControl='force'
    const forcedTool = forcedTools[0]

    // Adjust format based on provider
    if (provider === 'anthropic') {
      toolChoice = {
        type: 'tool',
        name: forcedTool.id,
      }
    } else if (provider === 'google') {
      // Google Gemini format uses a separate toolConfig object
      toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames:
            forcedTools.length === 1
              ? [forcedTool.id] // If only one tool, specify just that one
              : forcedToolIds, // If multiple tools, include all of them
        },
      }
      // Keep toolChoice as 'auto' since we use toolConfig instead
      toolChoice = 'auto'
    } else {
      // Default OpenAI format
      toolChoice = {
        type: 'function',
        function: { name: forcedTool.id },
      }
    }

    logger.info(`Forcing use of tool: ${forcedTool.id}`)

    if (forcedTools.length > 1) {
      logger.info(
        `Multiple tools set to 'force' mode (${forcedToolIds.join(', ')}). Will cycle through them sequentially.`
      )
    }
  } else {
    // Default to auto if no forced tools
    toolChoice = 'auto'
    if (provider === 'google') {
      toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
    }
    logger.info('Setting tool_choice to auto - letting model decide which tools to use')
  }

  return {
    tools: filteredTools,
    toolChoice,
    toolConfig,
    hasFilteredTools,
    forcedTools: forcedToolIds,
  }
}

/**
 * Checks if a forced tool has been used in a response and manages the tool_choice accordingly
 *
 * @param toolCallsResponse Array of tool calls in the response
 * @param originalToolChoice The original tool_choice setting used in the request
 * @param logger Logger instance to use for logging
 * @param provider Optional provider ID to adjust format for specific providers
 * @param forcedTools Array of all tool IDs that should be forced in sequence
 * @param usedForcedTools Array of tool IDs that have already been used
 * @returns Object containing tracking information and next tool choice
 */
export function trackForcedToolUsage(
  toolCallsResponse: any[] | undefined,
  originalToolChoice: any,
  logger: any,
  provider?: string,
  forcedTools: string[] = [],
  usedForcedTools: string[] = []
): {
  hasUsedForcedTool: boolean
  usedForcedTools: string[]
  nextToolChoice?:
    | 'auto'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } }
    | null
  nextToolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE'
      allowedFunctionNames?: string[]
    }
  }
} {
  // Default to keeping the original tool_choice
  let hasUsedForcedTool = false
  let nextToolChoice = originalToolChoice
  let nextToolConfig:
    | {
        functionCallingConfig: {
          mode: 'AUTO' | 'ANY' | 'NONE'
          allowedFunctionNames?: string[]
        }
      }
    | undefined

  const updatedUsedForcedTools = [...usedForcedTools]

  // Special handling for Google format
  const isGoogleFormat = provider === 'google'

  // Get the name of the current forced tool(s)
  let forcedToolNames: string[] = []
  if (isGoogleFormat && originalToolChoice?.functionCallingConfig?.allowedFunctionNames) {
    // For Google format
    forcedToolNames = originalToolChoice.functionCallingConfig.allowedFunctionNames
  } else if (
    typeof originalToolChoice === 'object' &&
    (originalToolChoice?.function?.name ||
      (originalToolChoice?.type === 'tool' && originalToolChoice?.name) ||
      (originalToolChoice?.type === 'any' && originalToolChoice?.any?.name))
  ) {
    // For other providers
    forcedToolNames = [
      originalToolChoice?.function?.name ||
        originalToolChoice?.name ||
        originalToolChoice?.any?.name,
    ].filter(Boolean)
  }

  // If we're forcing specific tools and we have tool calls in the response
  if (forcedToolNames.length > 0 && toolCallsResponse && toolCallsResponse.length > 0) {
    // Check if any of the tool calls used the forced tools
    const toolNames = toolCallsResponse.map((tc) => tc.function?.name || tc.name || tc.id)

    // Find any forced tools that were used
    const usedTools = forcedToolNames.filter((toolName) => toolNames.includes(toolName))

    if (usedTools.length > 0) {
      // At least one forced tool was used
      hasUsedForcedTool = true
      updatedUsedForcedTools.push(...usedTools)

      // Find the next tools to force that haven't been used yet
      const remainingTools = forcedTools.filter((tool) => !updatedUsedForcedTools.includes(tool))

      if (remainingTools.length > 0) {
        // There are still forced tools to use
        const nextToolToForce = remainingTools[0]

        // Format based on provider
        if (provider === 'anthropic') {
          nextToolChoice = {
            type: 'tool',
            name: nextToolToForce,
          }
        } else if (provider === 'google') {
          nextToolConfig = {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames:
                remainingTools.length === 1
                  ? [nextToolToForce] // If only one tool left, specify just that one
                  : remainingTools, // If multiple tools, include all remaining
            },
          }
        } else {
          // Default OpenAI format
          nextToolChoice = {
            type: 'function',
            function: { name: nextToolToForce },
          }
        }

        logger.info(
          `Forced tool(s) ${usedTools.join(', ')} used, switching to next forced tool(s): ${remainingTools.join(', ')}`
        )
      } else {
        // All forced tools have been used, switch to auto mode
        if (provider === 'anthropic') {
          nextToolChoice = null // Anthropic requires null to remove the parameter
        } else if (provider === 'google') {
          nextToolConfig = { functionCallingConfig: { mode: 'AUTO' } }
        } else {
          nextToolChoice = 'auto'
        }

        logger.info('All forced tools have been used, switching to auto mode for future iterations')
      }
    }
  }

  return {
    hasUsedForcedTool,
    usedForcedTools: updatedUsedForcedTools,
    nextToolChoice: hasUsedForcedTool ? nextToolChoice : originalToolChoice,
    nextToolConfig: isGoogleFormat
      ? hasUsedForcedTool
        ? nextToolConfig
        : originalToolChoice
      : undefined,
  }
}

export function isDeepResearchModel(model: string): boolean {
  return getModelCapabilities(model)?.deepResearch ?? false
}

export function isGemini3OrLaterModel(model: string): boolean {
  const normalizedModel = model.toLowerCase().replace(/^vertex\//, '')
  return Number(normalizedModel.match(/^gemini-(\d+)(?:[.-]|$)/)?.[1]) >= 3
}

/**
 * Prepare tool execution parameters, separating tool parameters from system parameters
 */
export function prepareToolExecution(
  tool: { params?: Record<string, any> },
  llmArgs: Record<string, any>,
  request: {
    workflowId?: string
    workspaceId?: string // Add workspaceId for MCP tools
    workflowLogId?: string
    toolExecutionId?: string
    submissionSource?: ExecutionSubmissionSource
    chatId?: string
    userId?: string
    environmentVariables?: Record<string, any>
    workflowVariables?: Record<string, any>
    blockData?: Record<string, any>
    blockNameMapping?: Record<string, string>
    isDeployedContext?: boolean
  }
): {
  toolParams: Record<string, any>
  executionParams: Record<string, any>
} {
  // User-provided params take precedence over LLM-generated params
  const toolParams = {
    ...llmArgs,
    ...tool.params,
  }

  const context = {
    ...(request.workflowId ? { workflowId: request.workflowId } : {}),
    ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
    ...(request.workflowLogId ? { workflowLogId: request.workflowLogId } : {}),
    ...(request.toolExecutionId ? { toolExecutionId: request.toolExecutionId } : {}),
    ...(request.submissionSource ? { submissionSource: request.submissionSource } : {}),
    ...(request.chatId ? { chatId: request.chatId } : {}),
    ...(request.userId ? { userId: request.userId } : {}),
    isDeployedContext: request.isDeployedContext ?? true,
  }

  // Add system parameters for execution
  const executionParams = {
    ...toolParams,
    ...(Object.keys(context).length > 0 ? { _context: context } : {}),
    ...(request.environmentVariables ? { envVars: request.environmentVariables } : {}),
    ...(request.workflowVariables ? { workflowVariables: request.workflowVariables } : {}),
    ...(request.blockData ? { blockData: request.blockData } : {}),
    ...(request.blockNameMapping ? { blockNameMapping: request.blockNameMapping } : {}),
  }

  return { toolParams, executionParams }
}

export function createOpenAICompatibleStream(
  stream: AsyncIterable<ChatCompletionChunk & { x_groq?: { usage?: CompletionUsage } }>,
  providerName: string,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  const streamLogger = createLogger(`${providerName}Utils`)
  let fullContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const usage = chunk.x_groq ? chunk.x_groq.usage : chunk.usage
          if (usage) {
            promptTokens = usage.prompt_tokens ?? 0
            completionTokens = usage.completion_tokens ?? 0
            totalTokens = usage.total_tokens ?? 0
          }

          const content = chunk.choices?.[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            streamLogger.warn(`${providerName} stream completed without usage data`)
          }

          onComplete(fullContent, {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens || promptTokens + completionTokens,
          })
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

export function checkForForcedToolUsageOpenAI(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string },
  providerName: string,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  if (typeof toolChoice !== 'object' || !response?.choices?.[0]?.message?.tool_calls) {
    return {
      hasUsedForcedTool: false,
      usedForcedTools,
    }
  }

  const result = trackForcedToolUsage(
    response.choices[0].message.tool_calls,
    toolChoice,
    createLogger(`${providerName}Utils`),
    providerName.toLowerCase().replace(/\s+/g, '-'),
    forcedTools,
    usedForcedTools
  )

  return {
    hasUsedForcedTool: result.hasUsedForcedTool,
    usedForcedTools: result.usedForcedTools,
  }
}
