import {
  buildCustomToolModelDescription,
  getCustomToolEntityIdFromRuntimeId,
} from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import { stringifySubBlockValue } from '@/lib/workflows/subblock-values'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import { parseAgentStructuredResponse } from '@/executor/handlers/agent/response-format'
import type {
  AgentInputs,
  Message,
  StreamingConfig,
  ToolInput,
} from '@/executor/handlers/agent/types'
import { getBlockToolExecutionId } from '@/executor/handlers/tool-execution-context'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { getProviderFromModel } from '@/providers/ai/models'
import { transformBlockTool } from '@/providers/ai/utils'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool, getToolAsync } from '@/tools'
import { createLLMToolSchema } from '@/tools/params'
import { getTool } from '@/tools/utils'
import {
  buildLoadSkillTool,
  buildSkillsSystemPromptSection,
  createSkillLoaderToolId,
} from './skill-loader'
import { resolveSkillMetadata } from './skills-resolver'

const logger = createLogger('AgentBlockHandler')

const DEFAULT_FUNCTION_TIMEOUT = 600000
const REQUEST_TIMEOUT = 120000

/**
 * Helper function to collect runtime block outputs and name mappings
 * for tag resolution in custom tools and prompts
 */
function collectBlockData(context: ExecutionContext): {
  blockData: Record<string, any>
  blockNameMapping: Record<string, string>
} {
  const blockData: Record<string, any> = {}
  const blockNameMapping: Record<string, string> = {}

  for (const [id, state] of context.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output
      const workflowBlock = context.workflow?.blocks?.find((b) => b.id === id)
      if (workflowBlock?.metadata?.name) {
        // Map both the display name and normalized form
        blockNameMapping[workflowBlock.metadata.name] = id
        const normalized = workflowBlock.metadata.name.replace(/\s+/g, '').toLowerCase()
        blockNameMapping[normalized] = id
      }
    }
  }

  return { blockData, blockNameMapping }
}

/**
 * Handler for Agent blocks that process LLM requests with optional tools.
 */
export class AgentBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.AGENT
  }

  async execute(
    block: SerializedBlock,
    inputs: AgentInputs,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing agent block: ${block.id}`)

    const model = inputs.model
    if (!model) throw new Error('Agent model is required')
    const responseFormat = this.parseResponseFormat(inputs.responseFormat)
    const providerId = getProviderFromModel(model)
    const formattedTools = await this.formatTools(inputs.tools || [], context)
    const skillInputs = Array.isArray(inputs.skills)
      ? inputs.skills.filter((skill) => skill?.skillId)
      : []
    const skillMetadata =
      skillInputs.length > 0 && context.workspaceId
        ? await resolveSkillMetadata(
            skillInputs,
            context.workspaceId,
            context.isDeployedContext !== false
          )
        : []
    const skillLoaderToolId =
      skillMetadata.length > 0
        ? createSkillLoaderToolId(
            formattedTools
              .map((tool) => (typeof tool?.id === 'string' ? tool.id : ''))
              .filter((toolId) => toolId.length > 0)
          )
        : null

    if (skillMetadata.length > 0 && skillLoaderToolId) {
      formattedTools.push(buildLoadSkillTool(skillLoaderToolId, skillMetadata))
    }

    const streamingConfig = this.getStreamingConfig(block, context)
    const messages = this.buildMessages(inputs, skillMetadata, skillLoaderToolId)

    const providerRequest = this.buildProviderRequest({
      providerId,
      model,
      messages,
      inputs,
      formattedTools,
      responseFormat,
      block,
      context,
      streaming: streamingConfig.shouldUseStreaming ?? false,
    })

    return this.executeProviderRequest(providerRequest, block, responseFormat, context)
  }

  private parseResponseFormat(responseFormat?: string | object): any {
    if (responseFormat == null || responseFormat === '') return undefined
    let format: unknown = responseFormat
    if (typeof responseFormat === 'string') {
      if (!responseFormat.trim()) return undefined
      try {
        format = JSON.parse(responseFormat)
      } catch {
        throw new Error('Invalid agent response format: expected valid JSON with a schema object')
      }
    }
    if (
      !format ||
      typeof format !== 'object' ||
      Array.isArray(format) ||
      !('schema' in format) ||
      !format.schema ||
      typeof format.schema !== 'object' ||
      Array.isArray(format.schema)
    ) {
      throw new Error(
        'Invalid agent response format: expected an object containing a schema object'
      )
    }
    return format
  }

  private async formatTools(inputTools: ToolInput[], context: ExecutionContext): Promise<any[]> {
    if (!Array.isArray(inputTools)) return []

    const tools = await Promise.all(
      inputTools
        .filter((tool) => {
          const usageControl = tool.usageControl || 'auto'
          return usageControl !== 'none'
        })
        .map(async (tool) => {
          try {
            if (tool.type === 'custom-tool' && tool.schema) {
              return await this.createCustomTool(tool, context)
            }
            if (tool.type === 'mcp') {
              return await this.createMcpTool(tool, context)
            }
            return await this.transformBlockTool(tool, context)
          } catch (error) {
            logger.warn(
              `Skipping unavailable agent tool ${tool.title || tool.toolId || tool.type}:`,
              error
            )
            return null
          }
        })
    )

    return tools.filter((tool): tool is NonNullable<typeof tool> => tool !== null)
  }

  private async createCustomTool(tool: ToolInput, context: ExecutionContext): Promise<any> {
    const userProvidedParams = tool.params || {}

    const { filterSchemaForLLM, mergeToolParameters } = await import('@/tools/params')

    const filteredSchema = filterSchemaForLLM(tool.schema.function.parameters, userProvidedParams)

    const toolId = tool.toolId
    getCustomToolEntityIdFromRuntimeId(toolId)
    const base: any = {
      id: toolId,
      name: tool.title?.trim(),
      description: buildCustomToolModelDescription({
        title: tool.title,
        description: tool.schema.function.description,
      }),
      params: userProvidedParams,
      parameters: {
        ...filteredSchema,
        type: tool.schema.function.parameters.type,
      },
      usageControl: tool.usageControl || 'auto',
    }

    if (tool.code) {
      base.executeFunction = async (callParams: Record<string, any>) => {
        // Merge user-provided parameters with LLM-generated parameters
        const mergedParams = mergeToolParameters(userProvidedParams, callParams)

        // Collect block outputs for tag resolution
        const { blockData, blockNameMapping } = collectBlockData(context)

        const result = await executeTool(
          'function_execute',
          {
            code: tool.code,
            ...mergedParams,
            timeout: tool.timeout ?? DEFAULT_FUNCTION_TIMEOUT,
            envVars: context.environmentVariables || {},
            workflowVariables: context.workflowVariables || {},
            blockData,
            blockNameMapping,
            isCustomTool: true,
          },
          false, // skipPostProcess
          context // execution context for file processing
        )

        if (!result.success) {
          throw new Error(result.error || 'Function execution failed')
        }
        return result.output
      }
    }

    return base
  }

  private async createMcpTool(tool: ToolInput, context: ExecutionContext): Promise<any> {
    const { serverId, toolName, ...userProvidedParams } = tool.params || {}

    if (!serverId || !toolName) {
      throw new Error('MCP tool selection is missing serverId or toolName')
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (typeof window === 'undefined') {
      try {
        const { generateInternalToken } = await import('@/lib/auth/internal')
        const internalToken = await generateInternalToken(context.userId)
        headers.Authorization = `Bearer ${internalToken}`
      } catch (error) {
        logger.error(`Failed to generate internal token for MCP tool discovery:`, error)
      }
    }

    const url = new URL('/api/mcp/tools/discover', getBaseUrl())
    url.searchParams.set('serverId', serverId)
    if (context.workspaceId) {
      url.searchParams.set('workspaceId', context.workspaceId)
    } else {
      throw new Error('workspaceId is required for MCP tool discovery')
    }
    if (context.workflowId) {
      url.searchParams.set('workflowId', context.workflowId)
    } else {
      throw new Error('workflowId is required for internal JWT authentication')
    }
    url.searchParams.set('isDeployedContext', String(context.isDeployedContext !== false))

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(
        `Failed to discover tools from MCP server ${serverId} (status ${response.status})${errorText ? `: ${errorText}` : ''}`
      )
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || `MCP tool discovery failed for server ${serverId}`)
    }

    const mcpTool = data.data.tools.find((t: any) => t.name === toolName)
    if (!mcpTool) {
      throw new Error(`MCP tool ${toolName} not found on server ${serverId}`)
    }

    const toolId = createMcpToolId(serverId, toolName)

    const { filterSchemaForLLM } = await import('@/tools/params')
    const filteredSchema = filterSchemaForLLM(
      mcpTool.inputSchema || { type: 'object', properties: {} },
      userProvidedParams
    )

    return {
      id: toolId,
      name: toolName,
      description: mcpTool.description || `MCP tool ${toolName} from ${mcpTool.serverName}`,
      parameters: filteredSchema,
      params: userProvidedParams,
      usageControl: tool.usageControl || 'auto',
      executeFunction: async (callParams: Record<string, any>) => {
        logger.info(`Executing MCP tool ${toolName} on server ${serverId}`)

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }

        if (typeof window === 'undefined') {
          try {
            const { generateInternalToken } = await import('@/lib/auth/internal')
            const internalToken = await generateInternalToken(context.userId)
            headers.Authorization = `Bearer ${internalToken}`
          } catch (error) {
            logger.error(`Failed to generate internal token for MCP tool ${toolName}:`, error)
          }
        }

        const execResponse = await fetch(`${getBaseUrl()}/api/mcp/tools/execute`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            serverId,
            toolName,
            arguments: callParams,
            workspaceId: context.workspaceId,
            workflowId: context.workflowId,
            isDeployedContext: context.isDeployedContext !== false,
          }),
        })

        if (!execResponse.ok) {
          throw new Error(
            `MCP tool execution failed: ${execResponse.status} ${execResponse.statusText}`
          )
        }

        const result = await execResponse.json()
        if (!result.success) {
          throw new Error(result.error || 'MCP tool execution failed')
        }

        return {
          success: true,
          output: result.data.output || {},
          metadata: {
            source: 'mcp',
            serverId,
            serverName: mcpTool.serverName,
            toolName,
          },
        }
      },
    }
  }

  private async transformBlockTool(tool: ToolInput, context: ExecutionContext) {
    const transformedTool = await transformBlockTool(tool, {
      selectedOperation: tool.operation,
      getAllBlocks,
      getToolAsync: (toolId: string) =>
        getToolAsync(
          toolId,
          context.workflowId,
          context.workspaceId,
          context.isDeployedContext !== false
        ),
      getTool,
      createLLMToolSchema,
    })

    if (!transformedTool) {
      throw new Error(`Agent tool ${tool.title || tool.toolId || tool.type} could not be resolved`)
    }
    transformedTool.usageControl = tool.usageControl || 'auto'
    return transformedTool
  }

  private getStreamingConfig(block: SerializedBlock, context: ExecutionContext): StreamingConfig {
    const selectedOutputs = context.selectedOutputs ?? []
    const isBlockSelectedForOutput =
      selectedOutputs.length === 0 ||
      selectedOutputs.some((outputId) => {
        if (outputId === block.id) return true
        const firstUnderscoreIndex = outputId.indexOf('_')
        return (
          firstUnderscoreIndex !== -1 && outputId.substring(0, firstUnderscoreIndex) === block.id
        )
      })

    const hasOutgoingConnections = context.edges?.some((edge) => edge.source === block.id) ?? false
    const shouldUseStreaming = Boolean(context.stream) && isBlockSelectedForOutput

    return { shouldUseStreaming, isBlockSelectedForOutput, hasOutgoingConnections }
  }

  private buildMessages(
    inputs: AgentInputs,
    skillMetadata: Array<{ id: string; name: string; description: string }> = [],
    skillLoaderToolId?: string | null
  ): Message[] | undefined {
    let messages: Message[] = inputs.memories ? this.processMemories(inputs.memories) : []

    if (inputs.systemPrompt) {
      messages = messages.filter((message) => message.role !== 'system')
      messages.unshift({ role: 'system', content: stringifySubBlockValue(inputs.systemPrompt) })
    }

    if (inputs.userPrompt) {
      messages.push({ role: 'user', content: stringifySubBlockValue(inputs.userPrompt) })
    }

    if (skillMetadata.length > 0 && skillLoaderToolId) {
      const skillSection = buildSkillsSystemPromptSection(skillMetadata, skillLoaderToolId)
      const systemIndex = messages.findIndex((message) => message.role === 'system')

      if (systemIndex >= 0) {
        messages[systemIndex] = {
          ...messages[systemIndex],
          content: `${messages[systemIndex].content}${skillSection}`,
        }
      } else {
        messages.unshift({ role: 'system', content: skillSection.trim() })
      }
    }

    return messages.length > 0 ? messages : undefined
  }

  private processMemories(memories: any): Message[] {
    if (!memories) return []

    let memoryArray: any[] = []
    if (memories?.memories && Array.isArray(memories.memories)) {
      memoryArray = memories.memories
    } else if (Array.isArray(memories)) {
      memoryArray = memories
    }

    const messages: Message[] = []
    memoryArray.forEach((memory: any) => {
      if (memory.data && Array.isArray(memory.data)) {
        memory.data.forEach((msg: any) => {
          if (msg.role && msg.content && ['system', 'user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role as 'system' | 'user' | 'assistant',
              content: msg.content,
            })
          }
        })
      } else if (
        memory.role &&
        memory.content &&
        ['system', 'user', 'assistant'].includes(memory.role)
      ) {
        messages.push({
          role: memory.role as 'system' | 'user' | 'assistant',
          content: memory.content,
        })
      }
    })

    return messages
  }

  private buildProviderRequest(config: {
    providerId: string
    model: string
    messages: Message[] | undefined
    inputs: AgentInputs
    formattedTools: any[]
    responseFormat: any
    block: SerializedBlock
    context: ExecutionContext
    streaming: boolean
  }) {
    const {
      providerId,
      model,
      messages,
      inputs,
      formattedTools,
      responseFormat,
      block,
      context,
      streaming,
    } = config

    // Collect block outputs for runtime resolution
    const { blockData, blockNameMapping } = collectBlockData(context)

    return {
      provider: providerId,
      model,
      tools: formattedTools,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey,
      azureEndpoint: inputs.azureEndpoint,
      azureApiVersion: inputs.azureApiVersion,
      responseFormat,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      workflowLogId: context.workflowLogId,
      submissionSource: context.submissionSource,
      toolExecutionId: getBlockToolExecutionId(block, context),
      stream: streaming,
      messages,
      environmentVariables: context.environmentVariables || {},
      workflowVariables: context.workflowVariables || {},
      blockData,
      blockNameMapping,
      isDeployedContext: context.isDeployedContext !== false,
      reasoningEffort: inputs.reasoningEffort,
      verbosity: inputs.verbosity,
      thinkingLevel: inputs.thinkingLevel,
    }
  }

  private async executeProviderRequest(
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    const providerId = providerRequest.provider
    const model = providerRequest.model
    const providerStartTime = Date.now()

    try {
      const isBrowser = typeof window !== 'undefined'

      if (!isBrowser) {
        return this.executeServerSide(
          providerRequest,
          block,
          responseFormat,
          context,
          providerStartTime
        )
      }
      return this.executeBrowserSide(
        providerRequest,
        block,
        responseFormat,
        context,
        providerStartTime
      )
    } catch (error) {
      this.handleExecutionError(error, providerStartTime, providerId, model, context, block)
      throw error
    }
  }

  private async executeServerSide(
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext,
    providerStartTime: number
  ) {
    logger.info('Using direct server provider request')

    const [{ executeProviderRequest }, { getApiKey }] = await Promise.all([
      import('@/providers/ai'),
      import('@/providers/ai/utils-server'),
    ])
    const apiKey = await getApiKey(
      providerRequest.provider,
      providerRequest.model,
      providerRequest.apiKey
    )
    const result = await executeProviderRequest(providerRequest.provider, {
      ...providerRequest,
      apiKey,
      userId: context.userId,
    })

    this.logExecutionSuccess(
      providerRequest.provider,
      providerRequest.model,
      context,
      block,
      providerStartTime,
      result
    )

    return this.processProviderResponse(
      this.withToolCallMetadata(result, providerRequest.tools),
      block,
      responseFormat
    )
  }

  private async executeBrowserSide(
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext,
    providerStartTime: number
  ) {
    return this.executeViaProviderApi(
      providerRequest,
      block,
      responseFormat,
      context,
      providerStartTime
    )
  }

  private async executeViaProviderApi(
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext,
    providerStartTime: number
  ) {
    logger.info('Using HTTP provider request')

    const url = new URL('/api/providers', getBaseUrl())
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (typeof window === 'undefined') {
      const { generateInternalToken } = await import('@/lib/auth/internal')
      headers.Authorization = `Bearer ${await generateInternalToken(context.userId)}`
    }
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(providerRequest),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    })

    if (!response.ok) {
      const errorMessage = await this.extractErrorMessage(response)
      throw new Error(errorMessage)
    }

    this.logExecutionSuccess(
      providerRequest.provider,
      providerRequest.model,
      context,
      block,
      providerStartTime,
      'HTTP response'
    )

    // Check if this is a streaming response
    const contentType = response.headers.get('Content-Type')
    if (contentType?.includes('text/event-stream')) {
      // Handle streaming response
      logger.info('Received streaming response')
      return this.handleStreamingResponse(response, block, providerRequest.tools)
    }

    // Handle regular JSON response
    const result = await response.json()
    return this.processProviderResponse(
      this.withToolCallMetadata(result, providerRequest.tools),
      block,
      responseFormat
    )
  }

  private handleStreamingResponse(
    response: Response,
    block: SerializedBlock,
    tools: any[]
  ): StreamingExecution {
    const executionDataHeader = response.headers.get('X-Execution-Data')
    if (!executionDataHeader || !response.body) {
      throw new Error('Streaming provider response requires a body and execution data')
    }
    let executionData: StreamingExecution['execution']
    try {
      executionData = JSON.parse(executionDataHeader)
    } catch {
      throw new Error('Invalid streaming execution data')
    }
    if (
      !executionData?.output ||
      !executionData.metadata ||
      typeof executionData.success !== 'boolean'
    ) {
      throw new Error('Invalid streaming execution data')
    }
    return this.processStreamingExecution(
      this.withToolCallMetadata(
        {
          stream: response.body,
          execution: {
            ...executionData,
            logs: [],
          },
        },
        tools
      ),
      block
    )
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    let errorMessage = `Provider API request failed with status ${response.status}`
    try {
      const errorData = await response.json()
      if (errorData.error) {
        errorMessage = errorData.error
      }
    } catch (_e) {
      // Use default message if JSON parsing fails
    }
    return errorMessage
  }

  private logExecutionSuccess(
    provider: string,
    model: string,
    context: ExecutionContext,
    block: SerializedBlock,
    startTime: number,
    response: any
  ) {
    const executionTime = Date.now() - startTime
    const responseType =
      response && typeof response === 'object' && 'stream' in response
        ? 'streaming-execution'
        : 'json'

    logger.info('Provider request completed successfully', {
      provider,
      model,
      workflowId: context.workflowId,
      blockId: block.id,
      executionTime,
      responseType,
    })
  }

  private handleExecutionError(
    error: any,
    startTime: number,
    provider: string,
    model: string,
    context: ExecutionContext,
    block: SerializedBlock
  ) {
    const executionTime = Date.now() - startTime

    logger.error('Error executing provider request:', {
      error,
      executionTime,
      provider,
      model,
      workflowId: context.workflowId,
      blockId: block.id,
    })

    if (!(error instanceof Error)) return

    logger.error('Provider request error details', {
      workflowId: context.workflowId,
      blockId: block.id,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    })

    if (error.name === 'AbortError') {
      throw new Error('Provider request timed out - the API took too long to respond')
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error(
        'Network error - unable to connect to provider API. Please check your internet connection.'
      )
    }
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      throw new Error('Unable to connect to server - DNS or connection issue')
    }
  }

  private processProviderResponse(
    response: any,
    block: SerializedBlock,
    responseFormat: any
  ): BlockOutput | StreamingExecution {
    if (this.isStreamingExecution(response)) {
      return this.processStreamingExecution(response, block)
    }

    return this.processRegularResponse(response, responseFormat)
  }

  private isStreamingExecution(response: any): boolean {
    return (
      response && typeof response === 'object' && 'stream' in response && 'execution' in response
    )
  }

  private processStreamingExecution(
    response: StreamingExecution,
    block: SerializedBlock
  ): StreamingExecution {
    const streamingExec = response as StreamingExecution
    logger.info(`Received StreamingExecution for block ${block.id}`)

    if (streamingExec.execution.output) {
      const execution = streamingExec.execution as any
      if (block.metadata?.name) execution.blockName = block.metadata.name
      if (block.metadata?.id) execution.blockType = block.metadata.id
      execution.blockId = block.id
      execution.isStreaming = true
    }

    return streamingExec
  }

  private processRegularResponse(result: any, responseFormat: any): BlockOutput {
    return {
      ...(responseFormat
        ? parseAgentStructuredResponse(result.content)
        : { content: result.content, model: result.model }),
      ...this.createResponseMetadata(result),
    }
  }

  private withToolCallMetadata(result: any, tools: any[] = []) {
    const toolNames = new Map<string, string>()
    for (const tool of tools) {
      if (typeof tool?.id === 'string' && typeof tool.name === 'string') {
        toolNames.set(tool.id, tool.name.trim())
      }
    }

    const apply = (toolCalls?: any[]) =>
      toolCalls?.forEach((toolCall) => {
        if (typeof toolCall?.name !== 'string') return
        const id = toolCall.name
        const name = toolNames.get(id)
        if (name) Object.assign(toolCall, { id, name })
      })

    if (this.isStreamingExecution(result)) {
      result.stream = result.stream.pipeThrough(
        new TransformStream({ flush: () => apply(result.execution.output.toolCalls?.list) })
      )
    } else {
      apply(result?.toolCalls)
    }
    return result
  }

  private createResponseMetadata(result: any) {
    return {
      tokens: result.tokens || { prompt: 0, completion: 0, total: 0 },
      toolResults: Array.isArray(result.toolResults) ? result.toolResults : [],
      toolCalls: {
        list: result.toolCalls || [],
        count: result.toolCalls?.length || 0,
      },
      providerTiming: result.timing,
      cost: result.cost,
    }
  }
}
