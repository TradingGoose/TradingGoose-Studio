import { Agent, type AgentExecutionOptions } from '@mastra/core/agent'
import { toStandardSchema } from '@mastra/core/schema'
import { type CoreTool, createTool } from '@mastra/core/tools'
import {
  buildCustomToolModelDescription,
  getCustomToolEntityIdFromRuntimeId,
  isCustomToolRuntimeId,
} from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { safeInferenceError } from '@/lib/mastra/errors'
import { normalizeNativeToolResult } from '@/lib/mastra/media'
import { assertNativeToolArguments, NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'
import {
  assertNativeCompletion,
  getInferenceFacts,
  getNativeFinalText,
  type InferenceFacts,
  withInferenceFacts,
} from '@/lib/mastra/result'
import { getAgentMemory } from '@/lib/mastra/runtime'
import type { resultAccounting } from '@/lib/mastra/usage'
import { mcpService } from '@/lib/mcp/service'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { stringifySubBlockValue } from '@/lib/workflows/subblock-values'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type {
  AgentInputs,
  AgentToolConfig,
  Message,
  ToolInput,
} from '@/executor/handlers/agent/types'
import { getBlockToolExecutionId } from '@/executor/handlers/tool-execution-context'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool, getToolAsync } from '@/tools'
import { createLLMToolSchema } from '@/tools/params'
import { getTool } from '@/tools/utils'
import { watchExecutionCancellation } from './cancellation'
import {
  buildLoadSkillTool,
  buildSkillsSystemPromptSection,
  createSkillLoaderToolId,
} from './skill-loader'
import { resolveSkillMetadata } from './skills-resolver'

const logger = createLogger('AgentBlockHandler')

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
    const maxSteps =
      inputs.maxSteps == null ||
      (typeof inputs.maxSteps === 'string' && inputs.maxSteps.trim() === '')
        ? undefined
        : Number(inputs.maxSteps)
    if (
      maxSteps !== undefined &&
      (!['number', 'string'].includes(typeof inputs.maxSteps) ||
        !Number.isSafeInteger(maxSteps) ||
        maxSteps < 1)
    )
      throw new Error('Max Steps must be a positive integer')
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

    const messages = this.buildMessages(inputs, skillMetadata, skillLoaderToolId)
    const selectedSystemMessages = messages.filter((message) => message.role === 'system')
    const modelMessages = messages.filter((message) => message.role !== 'system')
    const { blockData, blockNameMapping } = collectBlockData(context)
    const abortController = new AbortController()
    const signal = AbortSignal.any([abortController.signal, AbortSignal.timeout(REQUEST_TIMEOUT)])
    const { tools, toolResults } = createAgentToolSet(
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
    const work = await prepareModelRequest(
      {
        model,
        actorUserId: context.userId,
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        runId,
        purpose: 'workflow-agent',
        funding: inputs.apiKey ? 'byok' : 'account',
        executionId: context.executionId,
        signal,
      },
      {
        apiKey: inputs.apiKey,
        maxSteps,
        modelSettings: { temperature: inputs.temperature, maxOutputTokens: inputs.maxTokens },
        providerOptions: inputs.providerOptions,
      }
    )
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: block.id,
      name: block.metadata?.name || 'Workflow Agent',
      instructions: '',
      model: work.model,
      tools,
      memory: await getAgentMemory(),
      mastra: work.mastra,
    })
    const options: AgentExecutionOptions<any> = {
      ...work.options,
      inputProcessors: [
        {
          id: 'workflow-selected-systems',
          processInputStep: () => ({
            systemMessages: selectedSystemMessages as Array<{ role: 'system'; content: string }>,
          }),
        },
        ...work.options.inputProcessors,
      ],
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
            blockId: context.currentVirtualBlockId ?? block.id,
            runId,
          },
        },
      },
      structuredOutput: responseFormat
        ? {
            schema: toStandardSchema(responseFormat.schema),
            errorStrategy: 'strict',
            jsonPromptInjection: Object.keys(tools).length > 0,
          }
        : undefined,
      prepareStep: async (step) => {
        await cancellation.check()
        signal.throwIfAborted()
        return { ...policy.prepareStep(step), ...work.options.prepareStep(step) }
      },
    }
    const cancellation = watchExecutionCancellation(context.shouldCancelExecution, REQUEST_TIMEOUT)
    const abortFromWorkflow = () => abortController.abort(cancellation.signal.reason)
    cancellation.signal.addEventListener('abort', abortFromWorkflow, { once: true })
    const stopCancellationCheck = () => {
      cancellation.stop()
      cancellation.signal.removeEventListener('abort', abortFromWorkflow)
    }
    const complete = async (result: any) => {
      await work.usage.verifyComplete()
      stopCancellationCheck()
      const accounting = work.accounting()
      policy.assertComplete(result.steps)
      const output = extractAgentOutput(
        result,
        model,
        accounting,
        toolResults,
        responseFormat !== undefined
      )
      getInferenceFacts(output)!.history = history
      return output
    }
    const fail = async (error: unknown) => {
      stopCancellationCheck()
      const accounting = work.accounting()
      const failure = new Error(safeInferenceError(error, inputs.apiKey))
      const owned = {
        model,
        ...accounting,
      }
      Object.assign(failure, owned)
      const facts = {
        ...owned,
        toolResults,
        history,
        generatedFields: Object.keys(owned),
      }
      return withInferenceFacts(failure, facts)
    }
    if (!this.shouldStream(block, context)) {
      try {
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
    const startedAt = new Date()
    const execution: StreamingExecution['execution'] = {
      success: true,
      output: {},
      logs: [],
      metadata: { duration: 0 },
      isStreaming: true,
    }
    try {
      const nativeStream = options.structuredOutput
        ? await agent.stream(modelMessages, {
            ...options,
            structuredOutput: options.structuredOutput,
          })
        : await agent.stream(modelMessages, { ...options, structuredOutput: undefined })
      const reader = nativeStream.fullStream.getReader()
      // Follow consumed native events: the producer may already be preparing a later step.
      let streamedStep = -1
      let completedSteps: any[] = []
      let canStreamStepText = false
      let stepTextStreamed = false
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
                const result = await nativeStream.getFullOutput()
                Object.assign(execution.output, await complete(result))
                execution.metadata!.duration = Date.now() - startedAt.getTime()
                if (!stepTextStreamed)
                  controller.enqueue(new TextEncoder().encode(result.steps.at(-1)!.text))
                controller.close()
                return
              }
              if (value.type === 'step-start') {
                streamedStep += 1
                stepTextStreamed = false
                canStreamStepText =
                  !responseFormat &&
                  (Object.keys(tools).length === 0 ||
                    (streamedStep >= work.options.maxSteps - 1 &&
                      policy.prepareStep({ steps: completedSteps }).toolChoice === 'auto'))
              }
              if (value.type === 'step-finish' && value.payload.output.steps)
                completedSteps = value.payload.output.steps
              if (value.type === 'text-delta' && canStreamStepText) {
                stepTextStreamed = true
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
    return Promise.all(
      inputTools
        .filter((tool) => tool.usageControl !== 'none')
        .map((tool) => {
          if (tool.type === 'custom-tool' && tool.schema) return this.createCustomTool(tool)
          if (tool.type === 'mcp') return this.createMcpTool(tool, context)
          return this.transformBlockTool(tool, context)
        })
    )
  }

  private async createCustomTool(tool: ToolInput): Promise<AgentToolConfig> {
    const userProvidedParams = tool.params || {}

    const { filterSchemaForLLM } = await import('@/tools/params')

    const filteredSchema = filterSchemaForLLM(tool.schema.function.parameters, userProvidedParams)

    const toolId = tool.toolId
    getCustomToolEntityIdFromRuntimeId(toolId)
    return {
      id: toolId!,
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
  }

  private async createMcpTool(
    tool: ToolInput,
    context: ExecutionContext
  ): Promise<AgentToolConfig> {
    const { serverId, toolName, ...userProvidedParams } = tool.params || {}
    if (!serverId || !toolName)
      throw new Error('MCP tool selection is missing serverId or toolName')
    if (!context.userId || !context.workspaceId)
      throw new Error('Authenticated workspace context is required for MCP tool discovery')
    const permission = await getUserEntityPermissions(
      context.userId,
      'workspace',
      context.workspaceId
    )
    if (!permission || !['read', 'write', 'admin'].includes(permission))
      throw new Error('Workspace access required for MCP operations')
    const discovered = await mcpService.discoverServerTools(
      context.userId,
      serverId,
      context.workspaceId,
      context.isDeployedContext !== false
    )
    const mcpTool = discovered.find((candidate) => candidate.name === toolName)
    if (!mcpTool) throw new Error(`MCP tool ${toolName} not found on server ${serverId}`)
    if (mcpTool.inputSchema.type !== 'object') throw new Error('MCP input schema must be an object')
    const { filterSchemaForLLM } = await import('@/tools/params')
    return {
      id: createMcpToolId(serverId, toolName),
      mcp: { serverId, toolName },
      name: toolName,
      description: mcpTool.description || `MCP tool ${toolName} from ${mcpTool.serverName}`,
      parameters: filterSchemaForLLM(
        { ...mcpTool.inputSchema, type: 'object' },
        userProvidedParams
      ),
      params: userProvidedParams,
      usageControl: tool.usageControl || 'auto',
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

  private shouldStream(block: SerializedBlock, context: ExecutionContext): boolean {
    const selectedOutputs = context.selectedOutputs ?? []
    return (
      Boolean(context.stream) &&
      (selectedOutputs.length === 0 ||
        selectedOutputs.some((outputId) => {
          if (outputId === block.id) return true
          const firstUnderscoreIndex = outputId.indexOf('_')
          return (
            firstUnderscoreIndex !== -1 && outputId.substring(0, firstUnderscoreIndex) === block.id
          )
        }))
    )
  }

  private buildMessages(
    inputs: AgentInputs,
    skillMetadata: Array<{ id: string; name: string; description: string }> = [],
    skillLoaderToolId?: string | null
  ): Message[] {
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

    return messages
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

/** Allocate unique names within Mastra's limits; callbacks keep the original application tool ID. */
function namedAgentTools(configured: AgentToolConfig[]) {
  const maxLength = 63
  const named = configured.map((tool) => {
    let baseName = tool.id.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (!/^[a-zA-Z_]/.test(baseName)) baseName = `_${baseName}`
    return { tool, baseName: baseName.slice(0, maxLength) }
  })
  const reserved = new Set(named.map(({ baseName }) => baseName))
  const counts = new Map<string, number>()
  return named.map(({ tool, baseName }) => {
    const duplicate = named.filter((candidate) => candidate.baseName === baseName).length > 1
    if (!duplicate) return { tool, nativeName: baseName }
    let index = counts.get(baseName) ?? 0
    let nativeName: string
    do {
      const suffix = `__instance_${++index}`
      nativeName = `${baseName.slice(0, maxLength - suffix.length)}${suffix}`
    } while (reserved.has(nativeName))
    counts.set(baseName, index)
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
  const toolResults: NonNullable<InferenceFacts['toolResults']> = []
  const tools = Object.fromEntries(
    namedAgentTools(configured)
      .filter(({ tool }) => tool.usageControl !== 'none')
      .map(({ tool, nativeName }) => [
        nativeName,
        createTool({
          id: nativeName,
          strict: false,
          title: tool.name,
          description: tool.description,
          inputSchema: toStandardSchema(tool.parameters),
          execute: async (inputData, nativeContext) => {
            assertNativeToolArguments(inputData)
            const params = { ...(inputData as Record<string, any>), ...tool.params }
            let inference: InferenceFacts | undefined
            try {
              const result = await executeTool(
                tool.mcp ? 'mcp' : tool.id,
                {
                  ...(tool.mcp ? { ...tool.mcp, arguments: params } : params),
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
              const output = result.output
              inference = getInferenceFacts(output)
              if (result?.success === false)
                throw new Error(result.error || `Tool ${tool.id} failed`)
              const functional = inference ? { ...output } : output
              if (inference) for (const field of inference.generatedFields) delete functional[field]
              try {
                return await normalizeNativeToolResult(functional, {
                  actorUserId: scope.userId,
                  workspaceId: scope.workspaceId,
                  signal: nativeContext?.abortSignal
                    ? AbortSignal.any([nativeMedia.signal, nativeContext.abortSignal])
                    : nativeMedia.signal,
                })
              } catch (error) {
                // The effect is already complete; refuse unsafe model continuation.
                nativeMedia.abort(error)
                throw error
              }
            } catch (error) {
              inference = getInferenceFacts(error) ?? inference
              throw error
            } finally {
              if (inference)
                toolResults.push({ toolCallId: nativeContext?.agent?.toolCallId, inference })
            }
          },
        }),
      ])
  )
  return { tools, toolResults }
}

/** Force names are selected from observed successful calls in configured order. */
export function createForcedToolPolicy(tools: AgentToolConfig[]) {
  const forcedIds = namedAgentTools(tools)
    .filter(({ tool }) => tool.usageControl === 'force')
    .map(({ nativeName }) => nativeName)
  let forced = forcedIds
  let namesResolved = false
  const completedCount = (steps: any[] = []) => {
    let count = 0
    const seenCalls = new Set<string>()
    for (const step of steps)
      for (const call of step.toolCalls || []) {
        // prepareStep exposes flat AI SDK results; FullOutput exposes Mastra payload chunks.
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
    prepareStep({ steps, tools }: { steps: any[]; tools?: Record<string, unknown> }) {
      // Mastra supplies normalized names while retaining each configured instance's ID.
      const nativeTools = Object.entries(tools ?? {})
      if (!namesResolved) {
        const namesById = new Map(nativeTools.map(([name, tool]) => [(tool as CoreTool).id, name]))
        forced = forcedIds.map((id) => {
          const name = namesById.get(id)
          if (!name) throw new Error(`Required Agent tool is unavailable: ${id}`)
          return name
        })
        namesResolved = true
      }
      const pending = forced[completedCount(steps)]
      return {
        activeTools: pending ? [pending] : nativeTools.map(([name]) => name),
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

/** Extract only the workflow's supported output fields from public native results. */
export function extractAgentOutput(
  result: any,
  model: string,
  accounting: Awaited<ReturnType<typeof resultAccounting>>,
  toolResults: NonNullable<InferenceFacts['toolResults']> = [],
  structured = false
): BlockOutput {
  assertNativeCompletion(result)
  if (!result.steps.length) throw new Error('Agent generation has no completed model steps')
  if (
    structured &&
    (!result.object || typeof result.object !== 'object' || Array.isArray(result.object))
  ) {
    throw new Error('Agent response format requires a valid JSON object')
  }
  const facts = {
    model,
    ...accounting,
  }
  const business = structured ? result.object : { content: getNativeFinalText(result) }
  return withInferenceFacts(
    { ...facts, ...business },
    {
      ...facts,
      toolResults,
      generatedFields: Object.keys(facts).filter((key) => !Object.hasOwn(business, key)),
    }
  )
}
