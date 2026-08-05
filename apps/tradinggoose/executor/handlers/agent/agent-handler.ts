import {
  buildCustomToolModelDescription,
  getCustomToolEntityIdFromRuntimeId,
} from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type {
  AgentInputs,
  Message,
  StreamingConfig,
  ToolInput,
} from '@/executor/handlers/agent/types'
import { getBlockToolExecutionId } from '@/executor/handlers/tool-execution-context'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { getProviderFromModel, transformBlockTool } from '@/providers/ai/utils'
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

const DEFAULT_MODEL = 'gpt-4o'
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

    const responseFormat = this.parseResponseFormat(inputs.responseFormat)
    const model = inputs.model || DEFAULT_MODEL
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
    if (!responseFormat || responseFormat === '') return undefined

    // If already an object, process it directly
    if (typeof responseFormat === 'object' && responseFormat !== null) {
      const formatObj = responseFormat as any
      if (!formatObj.schema && !formatObj.name) {
        return {
          name: 'response_schema',
          schema: responseFormat,
          strict: true,
        }
      }
      return responseFormat
    }

    // Handle string values
    if (typeof responseFormat === 'string') {
      const trimmedValue = responseFormat.trim()

      // Check for variable references like <start.input>
      if (trimmedValue.startsWith('<') && trimmedValue.includes('>')) {
        logger.info('Response format contains variable reference:', {
          value: trimmedValue,
        })
        // Variable references should have been resolved by the resolver before reaching here
        // If we still have a variable reference, it means it couldn't be resolved
        // Return undefined to use default behavior (no structured response)
        return undefined
      }

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(trimmedValue)

        if (parsed && typeof parsed === 'object' && !parsed.schema && !parsed.name) {
          return {
            name: 'response_schema',
            schema: parsed,
            strict: true,
          }
        }
        return parsed
      } catch (error: any) {
        logger.warn('Failed to parse response format as JSON, using default behavior:', {
          error: error.message,
          value: trimmedValue,
        })
        // Return undefined instead of throwing - this allows execution to continue
        // without structured response format
        return undefined
      }
    }

    // For any other type, return undefined
    logger.warn('Unexpected response format type, using default behavior:', {
      type: typeof responseFormat,
      value: responseFormat,
    })
    return undefined
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
          context, // execution context for file processing
          { signal: context.workflowDeadlineSignal }
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
      signal: context.workflowDeadlineSignal,
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
          signal: context.workflowDeadlineSignal,
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
    if (
      !inputs.memories &&
      !inputs.systemPrompt &&
      !inputs.userPrompt &&
      skillMetadata.length === 0
    ) {
      return undefined
    }

    const messages: Message[] = []

    if (inputs.memories) {
      messages.push(...this.processMemories(inputs.memories))
    }

    if (inputs.systemPrompt) {
      this.addSystemPrompt(messages, inputs.systemPrompt)
    }

    if (inputs.userPrompt) {
      this.addUserPrompt(messages, inputs.userPrompt)
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

  private addSystemPrompt(messages: Message[], systemPrompt: any) {
    let content: string

    if (typeof systemPrompt === 'string') {
      content = systemPrompt
    } else {
      try {
        content = JSON.stringify(systemPrompt, null, 2)
      } catch (error) {
        content = String(systemPrompt)
      }
    }

    const systemMessages = messages.filter((msg) => msg.role === 'system')

    if (systemMessages.length > 0) {
      messages.splice(0, 0, { role: 'system', content })
      for (let i = messages.length - 1; i >= 1; i--) {
        if (messages[i].role === 'system') {
          messages.splice(i, 1)
        }
      }
    } else {
      messages.splice(0, 0, { role: 'system', content })
    }
  }

  private addUserPrompt(messages: Message[], userPrompt: any) {
    let content: string
    if (typeof userPrompt === 'object' && userPrompt.input) {
      content = String(userPrompt.input)
    } else if (typeof userPrompt === 'object') {
      content = JSON.stringify(userPrompt)
    } else {
      content = String(userPrompt)
    }

    messages.push({ role: 'user', content })
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

    const validMessages = this.validateMessages(messages)

    // Collect block outputs for runtime resolution
    const { blockData, blockNameMapping } = collectBlockData(context)

    return {
      provider: providerId,
      model,
      systemPrompt: validMessages ? undefined : inputs.systemPrompt,
      context: JSON.stringify(messages),
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
    }
  }

  private validateMessages(messages: Message[] | undefined): boolean {
    return (
      Array.isArray(messages) &&
      messages.length > 0 &&
      messages.every(
        (msg: any) =>
          typeof msg === 'object' &&
          msg !== null &&
          'role' in msg &&
          typeof msg.role === 'string' &&
          ('content' in msg ||
            (msg.role === 'assistant' && ('function_call' in msg || 'tool_calls' in msg)))
      )
    )
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
      abortSignal: context.workflowDeadlineSignal,
      claimRemoteDispatch:
        context.workflowOperationId && context.claimWorkflowOperationRemoteDispatch
          ? () => context.claimWorkflowOperationRemoteDispatch!(context.workflowOperationId!)
          : undefined,
      onOperationIdentity:
        context.workflowOperationId && context.publishWorkflowOperationIdentity
          ? (identity: {
              adapterKind: string
              capability: 'status_only'
              remoteOperationId: string
              observation?: Record<string, unknown>
            }) => context.publishWorkflowOperationIdentity!(context.workflowOperationId!, identity)
          : undefined,
      beginToolOperation:
        context.registerWorkflowOperation && context.completeWorkflowOperation
          ? async (toolId: string) => {
              const operationId = await context.registerWorkflowOperation!(block.id, 'agent_tool')
              return {
                runtime: {
                  signal: context.workflowDeadlineSignal,
                  prepareDurableCredential: context.prepareWorkflowOperationCredential
                    ? (secret) => context.prepareWorkflowOperationCredential!(operationId, secret)
                    : undefined,
                  claimRemoteDispatch: context.claimWorkflowOperationRemoteDispatch
                    ? () => context.claimWorkflowOperationRemoteDispatch!(operationId)
                    : undefined,
                  publishOperationIdentity: context.publishWorkflowOperationIdentity
                    ? (identity) => context.publishWorkflowOperationIdentity!(operationId, identity)
                    : undefined,
                  recordTerminalObservation: (state, observation) =>
                    context.completeWorkflowOperation!(operationId, state, observation),
                },
                finish: (state) =>
                  context.completeWorkflowOperation!(operationId, state, { toolId }),
              }
            }
          : undefined,
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
      signal: context.workflowDeadlineSignal
        ? AbortSignal.any([context.workflowDeadlineSignal, AbortSignal.timeout(REQUEST_TIMEOUT)])
        : AbortSignal.timeout(REQUEST_TIMEOUT),
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

  private async handleStreamingResponse(
    response: Response,
    block: SerializedBlock,
    tools: any[]
  ): Promise<StreamingExecution> {
    // Check if we have execution data in headers (from StreamingExecution)
    const executionDataHeader = response.headers.get('X-Execution-Data')

    if (executionDataHeader) {
      // Parse execution data from header
      try {
        const executionData = JSON.parse(executionDataHeader)

        // Create StreamingExecution object
        return {
          stream: response.body!,
          execution: {
            success: executionData.success,
            output: this.withToolCallMetadata({ output: executionData.output }, tools).output || {},
            error: executionData.error,
            logs: [], // Logs are stripped from headers, will be populated by executor
            metadata: executionData.metadata || {
              duration: 0,
              startTime: new Date().toISOString(),
            },
            isStreaming: true,
            blockId: block.id,
            blockName: block.metadata?.name,
            blockType: block.metadata?.id,
          } as any,
        }
      } catch (error) {
        logger.error('Failed to parse execution data from header:', error)
        // Fall back to minimal streaming execution
      }
    }

    // Fallback for plain ReadableStream or when header parsing fails
    return this.createMinimalStreamingExecution(response.body!)
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
      response instanceof ReadableStream
        ? 'stream'
        : response && typeof response === 'object' && 'stream' in response
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

    if (response instanceof ReadableStream) {
      return this.createMinimalStreamingExecution(response)
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

  private createMinimalStreamingExecution(stream: ReadableStream): StreamingExecution {
    return {
      stream,
      execution: {
        success: true,
        output: {},
        logs: [],
        metadata: {
          duration: 0,
          startTime: new Date().toISOString(),
        },
      },
    }
  }

  private processRegularResponse(result: any, responseFormat: any): BlockOutput {
    if (responseFormat) {
      return this.processStructuredResponse(result, responseFormat)
    }

    return this.processStandardResponse(result)
  }

  private processStructuredResponse(result: any, responseFormat: any): BlockOutput {
    const content = result.content

    try {
      const extractedJson = JSON.parse(content.trim())
      logger.info('Successfully parsed structured response content')
      return {
        ...extractedJson,
        ...this.createResponseMetadata(result),
      }
    } catch (error) {
      logger.info('JSON parsing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      // LLM did not adhere to structured response format
      logger.error('LLM did not adhere to structured response format:', {
        content: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        responseFormat: responseFormat,
      })

      const standardResponse = this.processStandardResponse(result)
      return Object.assign(standardResponse, {
        _responseFormatWarning:
          'LLM did not adhere to the specified structured response format. Expected valid JSON but received malformed content. Falling back to standard format.',
      })
    }
  }

  private processStandardResponse(result: any): BlockOutput {
    return {
      content: result.content,
      model: result.model,
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

    apply(result?.toolCalls)
    apply(result?.execution?.output?.toolCalls?.list)
    apply(result?.output?.toolCalls?.list)
    return result
  }

  private createResponseMetadata(result: any) {
    return {
      tokens: result.tokens || { prompt: 0, completion: 0, total: 0 },
      toolResults: Array.isArray(result.toolResults) ? result.toolResults : [],
      toolCalls: {
        list: result.toolCalls ? result.toolCalls.map(this.formatToolCall.bind(this)) : [],
        count: result.toolCalls?.length || 0,
      },
      providerTiming: result.timing,
      cost: result.cost,
    }
  }

  private formatToolCall(tc: any) {
    return {
      ...tc,
      startTime: tc.startTime,
      endTime: tc.endTime,
      duration: tc.duration,
      arguments: tc.arguments || tc.input || {},
      result: tc.result || tc.output,
    }
  }
}
