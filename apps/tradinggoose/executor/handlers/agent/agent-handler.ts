import { Agent, type AgentExecutionOptions } from '@mastra/core/agent'
import { getModelReasoningOptions } from '@mastra/core/llm'
import { toStandardSchema } from '@mastra/core/schema'
import { createTool } from '@mastra/core/tools'
import {
  buildCustomToolModelDescription,
  getCustomToolEntityIdFromRuntimeId,
  isCustomToolRuntimeId,
} from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { safeInferenceError } from '@/lib/mastra/errors'
import { normalizeNativeToolResult } from '@/lib/mastra/media'
import {
  assertNativeToolArguments,
  NATIVE_AGENT_POLICY,
  parseProviderOptions,
  trustedModelSettings,
} from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { assertNativeCompletion, getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { getAgentMemory, getMastra } from '@/lib/mastra/runtime'
import { resultAccounting, selectNativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { usageProcessors } from '@/lib/mastra/usage-processors'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import { stringifySubBlockValue } from '@/lib/workflows/subblock-values'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type {
  AgentInputs,
  AgentToolConfig,
  Message,
  StreamingConfig,
  ToolInput,
} from '@/executor/handlers/agent/types'
import { getBlockToolExecutionId } from '@/executor/handlers/tool-execution-context'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
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

  /** Builds a native Agent request with resolved workflow inputs. */
  async execute(
    block: SerializedBlock,
    inputs: AgentInputs,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing agent block: ${block.id}`)

    const model = inputs.model
    if (!model) throw new Error('Agent model is required')
    assertListedModel(model)
    const responseFormat = this.parseResponseFormat(inputs.responseFormat)
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
    const skillLoaderToolId = skillMetadata.length
      ? createSkillLoaderToolId(formattedTools.map((tool) => tool.id))
      : undefined
    if (skillLoaderToolId) formattedTools.push(buildLoadSkillTool(skillLoaderToolId, skillMetadata))

    const messages = this.buildMessages(inputs, skillMetadata, skillLoaderToolId) || []
    const selectedSystemMessages = messages.filter((message) => message.role === 'system')
    const modelMessages = messages.filter((message) => message.role !== 'system')
    const { blockData, blockNameMapping } = collectBlockData(context)
    const abortController = new AbortController()
    const signal = AbortSignal.any([abortController.signal, AbortSignal.timeout(REQUEST_TIMEOUT)])
    const { tools, toolRuns } = createAgentToolSet(
      formattedTools,
      {
        ...context,
        toolExecutionId: getBlockToolExecutionId(block, context),
        environmentVariables: context.environmentVariables,
        workflowVariables: context.workflowVariables,
        blockData,
        blockNameMapping,
      },
      context,
      { signal, abort: (reason) => abortController.abort(reason) }
    )
    const policy = createForcedToolPolicy(formattedTools)
    const mastra = await getMastra()
    const startedAt = new Date()
    const runId = crypto.randomUUID()
    if (
      !context.workspaceId ||
      !context.executionId ||
      !context.workflowId ||
      !context.workflowLogId
    )
      throw new Error('Workflow Agent history requires its execution scope')
    const history = {
      threadId: `workflow-agent:${runId}`,
      resourceId: `workflow-execution:${context.workspaceId}:${context.executionId}`,
      runId,
    }
    const finance = await usageProcessors({
      actorUserId: context.userId,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      runId,
      purpose: 'workflow-agent',
      signal,
    })
    const admittedModel = createConfiguredLanguageModel(model, inputs.apiKey)
    const agent = new Agent({
      inputProcessors: [
        {
          id: 'workflow-selected-systems',
          processInputStep: () => ({
            systemMessages: selectedSystemMessages as Array<{ role: 'system'; content: string }>,
          }),
        },
        ...finance.inputProcessors,
      ],
      outputProcessors: finance.outputProcessors,
      ...NATIVE_AGENT_POLICY,
      id: block.id,
      name: block.metadata?.name || 'Workflow Agent',
      instructions: '',
      model: admittedModel,
      tools,
      memory: await getAgentMemory(),
      mastra,
    })
    const steps: any[] = []
    let finished = false
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined
    const checkCancellation = async () => {
      try {
        if (await context.shouldCancelExecution?.()) abortController.abort()
      } catch (error) {
        abortController.abort(error)
      }
      if (!finished && !signal.aborted) cancellationTimer = setTimeout(checkCancellation, 1000)
    }
    const stopCancellationCheck = () => {
      finished = true
      clearTimeout(cancellationTimer)
    }
    const options: AgentExecutionOptions<any> = {
      runId,
      memory: {
        resource: history.resourceId,
        thread: {
          id: history.threadId,
          metadata: {
            purpose: 'workflow-agent',
            logId: context.workflowLogId,
            systemMessages: selectedSystemMessages,
            workspaceId: context.workspaceId,
            executionId: context.executionId,
            workflowId: context.workflowId,
            blockId: block.id,
            runId,
          },
        },
      },
      abortSignal: signal,
      maxSteps: 20,
      modelSettings: trustedModelSettings({
        temperature: inputs.temperature,
        maxOutputTokens: inputs.maxTokens,
      }),
      maxProcessorRetries: 0,
      structuredOutput: responseFormat
        ? { schema: toStandardSchema(responseFormat.schema), errorStrategy: 'strict' }
        : undefined,
      tracingOptions: {
        metadata: { userId: context.userId, resourceId: context.workspaceId, runId },
      },
      providerOptions: parseProviderOptions(inputs.providerOptions),
      activeTools: Object.keys(tools),
      prepareStep: async (step) => {
        if (await context.shouldCancelExecution?.()) abortController.abort()
        signal.throwIfAborted()
        validateNativeReasoning(model, inputs.reasoningEffort, step.model.specificationVersion)
        return {
          ...policy.prepareStep(step),
          ...(inputs.reasoningEffort && inputs.reasoningEffort !== 'auto'
            ? { modelSettings: { ...step.modelSettings, reasoning: inputs.reasoningEffort as any } }
            : {}),
        }
      },
      onStepFinish: (step) => {
        steps.push(step)
      },
      onAbort: ({ steps: completed }) => {
        if (completed.length > steps.length) steps.splice(0, steps.length, ...completed)
      },
    }
    let returnedUsage: Parameters<typeof resultAccounting>[0]
    const capture = (usage = returnedUsage) =>
      resultAccounting(selectNativeUsage(usage, finance.getUsage(), sumNativeUsage(steps)))
    const complete = async (result: any) => {
      returnedUsage = selectNativeUsage(result.totalUsage, result.usage)
      await finance.verifyComplete()
      stopCancellationCheck()
      const accounting = await capture()
      policy.assertComplete(result.steps)
      const output = extractAgentOutput(
        result,
        model,
        accounting,
        toolRuns,
        responseFormat !== undefined,
        startedAt
      )
      getInferenceFacts(output)!.history = history
      return output
    }
    const fail = async (error: unknown) => {
      stopCancellationCheck()
      const accounting = await capture()
      const failure = new Error(safeInferenceError(error, inputs.apiKey))
      const owned = {
        model,
        ...accounting,
        ...extractCompletedToolMetadata(toolRuns),
      }
      Object.assign(failure, owned)
      const facts = {
        ...owned,
        history,
        generatedFields: Object.keys(owned),
      }
      return withInferenceFacts(failure, facts)
    }
    if (!this.getStreamingConfig(block, context).shouldUseStreaming) {
      try {
        if (context.shouldCancelExecution) cancellationTimer = setTimeout(checkCancellation, 1000)
        return await complete(
          options.structuredOutput
            ? await agent.generate(modelMessages, {
                ...options,
                structuredOutput: options.structuredOutput,
              })
            : await agent.generate(modelMessages, { ...options, structuredOutput: undefined })
        )
      } catch (error) {
        throw await fail(error)
      }
    }
    const execution: StreamingExecution['execution'] = {
      success: true,
      output: {},
      logs: [],
      metadata: { duration: 0 },
      isStreaming: true,
    }
    try {
      if (context.shouldCancelExecution) cancellationTimer = setTimeout(checkCancellation, 1000)
      const nativeStream = options.structuredOutput
        ? await agent.stream(modelMessages, {
            ...options,
            structuredOutput: options.structuredOutput,
          })
        : await agent.stream(modelMessages, { ...options, structuredOutput: undefined })
      const reader = nativeStream.fullStream.getReader()
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            while (true) {
              if (await context.shouldCancelExecution?.()) abortController.abort()
              signal.throwIfAborted()
              const { done, value } = await reader.read()
              if (await context.shouldCancelExecution?.()) abortController.abort()
              signal.throwIfAborted()
              if (done) {
                Object.assign(execution.output, await complete(await nativeStream.getFullOutput()))
                execution.metadata!.duration = Date.now() - startedAt.getTime()
                controller.close()
                return
              }
              if (value.type === 'text-delta') {
                controller.enqueue(new TextEncoder().encode(value.payload.text))
                return
              }
              if (value.type === 'error') throw value.payload.error
              if (value.type === 'abort') throw new Error('Agent generation was cancelled')
            }
          } catch (error) {
            const failure = await fail(error)
            execution.success = false
            execution.error = failure.message
            Object.assign(execution.output, failure)
            controller.error(failure)
          }
        },
        async cancel(reason) {
          abortController.abort(reason)
          await reader.cancel(reason)
          const failure = await fail(new Error('Agent generation was cancelled'))
          execution.success = false
          execution.error = failure.message
          Object.assign(execution.output, failure)
        },
      })
      return { stream, execution }
    } catch (error) {
      throw await fail(error)
    }
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

  private async formatTools(
    inputTools: ToolInput[],
    context: ExecutionContext
  ): Promise<AgentToolConfig[]> {
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
            if (tool.usageControl === 'force') {
              throw new Error(
                `Cannot prepare forced tool ${tool.title || tool.toolId || tool.type}: ${error instanceof Error ? error.message : String(error)}`
              )
            }
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
      base.executeFunction = async (callParams: Record<string, any>, signal?: AbortSignal) => {
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
          { signal }
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
      executeFunction: async (callParams: Record<string, any>, signal?: AbortSignal) => {
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
          signal,
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
    const blockDef = getAllBlocks().find((definition) => definition.type === tool.type)
    if (!blockDef) throw new Error(`Block definition not found for agent tool: ${tool.type}`)
    const toolId =
      (blockDef.tools?.access?.length || 0) > 1 && tool.operation && blockDef.tools?.config?.tool
        ? blockDef.tools.config.tool({ ...tool.params, operation: tool.operation })
        : blockDef.tools?.access?.[0]
    if (!toolId) throw new Error(`No tool configured for agent tool: ${tool.type}`)
    const toolConfig = isCustomToolRuntimeId(toolId)
      ? await getToolAsync(
          toolId,
          context.workflowId,
          context.workspaceId,
          context.isDeployedContext !== false
        )
      : getTool(toolId)
    if (!toolConfig) throw new Error(`Agent tool ${toolId} could not be resolved`)
    return {
      id: toolConfig.id,
      name: toolConfig.name,
      description: toolConfig.description,
      params: tool.params || {},
      parameters: createLLMToolSchema(toolConfig, tool.params || {}),
      usageControl: tool.usageControl || 'auto',
    }
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

    const shouldUseStreaming = Boolean(context.stream) && isBlockSelectedForOutput

    return { shouldUseStreaming, isBlockSelectedForOutput }
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
        // This is newly composed application text, not unchanged original Memory bytes.
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
          if (
            msg.role &&
            typeof msg.content === 'string' &&
            ['system', 'user', 'assistant'].includes(msg.role)
          ) {
            messages.push({
              role: msg.role as 'system' | 'user' | 'assistant',
              content: msg.content,
            })
          }
        })
      } else if (
        memory.role &&
        typeof memory.content === 'string' &&
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
}

/** Names identify configured instances; callbacks keep the original application tool ID. */
function namedAgentTools(configured: AgentToolConfig[]) {
  const reserved = new Set(configured.map((tool) => tool.id))
  const counts = new Map<string, number>()
  return configured.map((tool) => {
    const duplicate = configured.filter((candidate) => candidate.id === tool.id).length > 1
    if (!duplicate) return { tool, nativeName: tool.id }
    let index = counts.get(tool.id) ?? 0
    let nativeName: string
    do {
      nativeName = `${tool.id}__instance_${++index}`
    } while (reserved.has(nativeName))
    counts.set(tool.id, index)
    reserved.add(nativeName)
    return { tool, nativeName }
  })
}

/** Native tools invoke the existing authorization and workflow execution path. */
export function createAgentToolSet(
  configured: AgentToolConfig[],
  scope: Record<string, any>,
  executionContext: ExecutionContext | undefined,
  nativeMedia: { signal: AbortSignal; abort: (reason: unknown) => void }
) {
  const toolRuns: Array<Record<string, any>> = []
  const tools = Object.fromEntries(
    namedAgentTools(configured)
      .filter(({ tool }) => tool.usageControl !== 'none')
      .map(({ tool, nativeName }) => [
        nativeName,
        createTool({
          id: nativeName,
          title: tool.name,
          description: tool.description,
          inputSchema: toStandardSchema(tool.parameters),
          execute: async (inputData, nativeContext) => {
            assertNativeToolArguments(inputData)
            const startedAt = new Date()
            const params = { ...(inputData as Record<string, any>), ...tool.params }
            const run: Record<string, any> = {
              id: tool.id,
              nativeName,
              name: tool.name || tool.id,
              toolCallId: nativeContext?.agent?.toolCallId,
              arguments: params,
              startTime: startedAt.toISOString(),
              success: false,
            }
            toolRuns.push(run)
            try {
              const result = tool.executeFunction
                ? await tool.executeFunction(params, nativeContext?.abortSignal)
                : await executeTool(
                    tool.id,
                    {
                      ...params,
                      _context: {
                        workflowId: scope.workflowId,
                        workspaceId: scope.workspaceId,
                        workflowLogId: scope.workflowLogId,
                        toolExecutionId: scope.toolExecutionId,
                        submissionSource: scope.submissionSource,
                        userId: scope.userId,
                        executionId: scope.executionId,
                        isDeployedContext: scope.isDeployedContext !== false,
                      },
                      envVars: scope.environmentVariables,
                      workflowVariables: scope.workflowVariables,
                      blockData: scope.blockData,
                      blockNameMapping: scope.blockNameMapping,
                    },
                    false,
                    executionContext,
                    { signal: nativeContext?.abortSignal }
                  )
              run.result = tool.executeFunction ? result : result.output
              if (result?.success === false)
                throw new Error(result.error || `Tool ${tool.id} failed`)
              run.success = true
              const facts = getInferenceFacts(run.result)
              const functional = facts ? { ...run.result } : run.result
              if (facts) for (const field of facts.generatedFields) delete functional[field]
              try {
                return await normalizeNativeToolResult(functional, {
                  actorUserId: scope.userId,
                  workspaceId: scope.workspaceId,
                  signal: nativeContext?.abortSignal
                    ? AbortSignal.any([nativeMedia.signal, nativeContext.abortSignal])
                    : nativeMedia.signal,
                })
              } catch (error) {
                // The effect and raw result are already known; refuse unsafe model continuation.
                nativeMedia.abort(error)
                throw error
              }
            } catch (error) {
              if (
                getInferenceFacts(error) ||
                (error && typeof error === 'object' && ('cost' in error || 'tokens' in error))
              ) {
                run.result = error
              }
              run.error = error instanceof Error ? error.message : String(error)
              throw error
            } finally {
              run.endTime = new Date().toISOString()
              run.duration = Date.now() - startedAt.getTime()
            }
          },
        }),
      ])
  )
  return { tools, toolRuns }
}

/** Force names are selected from observed successful calls in configured order. */
export function createForcedToolPolicy(tools: AgentToolConfig[]) {
  const named = namedAgentTools(tools)
  const activeTools = named
    .filter(({ tool }) => tool.usageControl !== 'none')
    .map(({ nativeName }) => nativeName)
  const forced = named
    .filter(({ tool }) => tool.usageControl === 'force')
    .map(({ nativeName }) => nativeName)
  const completedCount = (steps: any[] = []) => {
    let count = 0
    const seenCalls = new Set<string>()
    for (const step of steps)
      for (const call of step.toolCalls || []) {
        const data = call.payload || call
        if (seenCalls.has(data.toolCallId)) continue
        seenCalls.add(data.toolCallId)
        if (count >= forced.length) continue
        if (data.toolName !== forced[count])
          throw new Error(
            `Native named tool selection was not honored: expected forced tool ${forced[count]}, received ${data.toolName}. Select a compatible model/tool/schema/thinking configuration or change this tool to Auto.`
          )
        if (
          (step.toolResults || []).some((result: any) => {
            const output = result.payload || result
            return (
              output.toolCallId === data.toolCallId &&
              !output.isError &&
              output.output?.type !== 'error-text' &&
              output.output?.type !== 'error-json'
            )
          })
        )
          count += 1
      }
    return count
  }
  return {
    prepareStep({ steps }: { steps: any[] }) {
      const pending = forced[completedCount(steps)]
      return {
        activeTools: pending ? [pending] : activeTools,
        toolChoice: pending ? { type: 'tool' as const, toolName: pending } : ('auto' as const),
      }
    },
    assertComplete(steps: any[] = []) {
      const pending = forced.slice(completedCount(steps))
      if (pending.length)
        throw new Error(
          `Agent did not complete forced tools: ${pending.join(', ')}. Select a model and tool/schema/thinking configuration that supports named tool calls, or change these tools to Auto.`
        )
    },
  }
}

export function validateNativeReasoning(model: string, effort?: string, version?: string) {
  if (!effort || effort === 'auto') return
  const options = getModelReasoningOptions(model)
  if (!options?.some((option) => option.type === 'effort' && option.values.includes(effort))) {
    throw new Error(
      `Reasoning effort ${effort} is not published for ${model}. Clear this field or select a listed value.`
    )
  }
  if (version !== 'v4')
    throw new Error(
      `Native reasoning control is unavailable for this model connection. Clear Reasoning Effort or use a connection with native reasoning support.`
    )
}

/** Extract only the workflow's supported output fields from public native results. */
export function extractAgentOutput(
  result: any,
  model: string,
  accounting: Awaited<ReturnType<typeof resultAccounting>>,
  toolRuns: Array<Record<string, any>> = [],
  structured = false,
  startedAt = new Date()
): BlockOutput {
  assertNativeCompletion(result)
  if (
    structured &&
    (!result.object || typeof result.object !== 'object' || Array.isArray(result.object))
  ) {
    throw new Error('Agent response format requires a valid JSON object')
  }
  const facts = {
    model,
    ...accounting,
    ...extractCompletedToolMetadata(toolRuns),
    toolCalls: { list: toolRuns, count: toolRuns.length },
    providerTiming: {
      duration: Date.now() - startedAt.getTime(),
      startTime: startedAt.toISOString(),
      endTime: new Date().toISOString(),
      segments: [],
    },
  }
  const business = structured ? result.object : { content: result.text }
  return withInferenceFacts(
    { ...facts, ...business },
    {
      ...facts,
      generatedFields: Object.keys(facts).filter((key) => !Object.hasOwn(business, key)),
    }
  )
}

/** Completed tool charges remain separate from native model spend on every outcome. */
export function extractCompletedToolMetadata(toolRuns: Array<Record<string, any>>) {
  const completed = toolRuns.filter((run) => run.success || run.result?.cost || run.result?.tokens)
  const seen = new Set<string>()
  let toolCost: number | undefined
  let unavailableToolCosts = 0
  for (const run of completed) {
    const facts = getInferenceFacts(run.result)
    if (!facts) continue
    const cost = facts.cost
    const ids: string[] = run.toolCallId ? [run.toolCallId] : []
    if (ids.length && ids.every((id) => seen.has(id))) continue
    ids.forEach((id) => seen.add(id))
    const amount = cost?.total ?? cost?.availableTotal
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
      toolCost = (toolCost ?? 0) + amount
    if (cost?.status === 'unavailable' || cost?.status === 'partial') unavailableToolCosts += 1
  }
  return {
    ...(toolCost !== undefined ? { toolCost } : {}),
    ...(unavailableToolCosts ? { unavailableToolCosts } : {}),
    toolResults: completed.map((run) => {
      const facts = getInferenceFacts(run.result)
      const result =
        run.result instanceof Error && facts
          ? withInferenceFacts({ name: 'Error', message: safeInferenceError(run.result) }, facts)
          : run.result
      return result && typeof result === 'object'
        ? { ...result, toolCallId: run.toolCallId }
        : result
    }),
  }
}
