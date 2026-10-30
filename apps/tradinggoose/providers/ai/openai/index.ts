import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers/ai/constants'
import { toError } from '@/providers/ai/error'
import type {
  FunctionCallResponse,
  Message,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/ai/types'
import { ProviderError } from '@/providers/ai/types'
import {
  createModelCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
  withToolCosts,
} from '@/providers/ai/utils'
import { executeTool } from '@/tools'

const logger = createLogger('OpenAIProvider')

export const openaiProvider: ProviderConfig = {
  id: 'openai',
  executeRequest: (request) =>
    executeResponsesRequest(request, new OpenAI({ apiKey: request.apiKey }), request.model),
}

export async function executeResponsesRequest(
  request: ProviderRequest,
  client: OpenAI,
  model: string
): Promise<ProviderResponse | StreamingExecution> {
  const messages: Message[] = [
    ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
    ...(request.context ? [{ role: 'user' as const, content: request.context }] : []),
    ...(request.messages ?? []),
  ]
  const input: OpenAI.Responses.ResponseInputItem[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.tool_call_id) throw new Error('OpenAI tool messages require tool_call_id')
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content ?? '',
      })
    } else if (message.content) {
      input.push({ role: message.role, content: message.content })
    }
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })
    }
  }
  if (!input.length) throw new Error('OpenAI requests require conversational input')

  const prepared = prepareToolsWithUsageControl(
    request.tools?.map((tool) => ({
      type: 'function',
      name: tool.id,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    })),
    request.tools,
    logger,
    'openai'
  )
  // The pinned SDK predates the catalog's reasoning efforts and text verbosity.
  const payload: any = { model, store: false }
  if (request.model.startsWith('azure/')) payload.include = ['reasoning.encrypted_content']
  if (request.temperature !== undefined) payload.temperature = request.temperature
  if (request.maxTokens !== undefined) payload.max_output_tokens = request.maxTokens
  if (request.reasoningEffort !== undefined) payload.reasoning = { effort: request.reasoningEffort }
  if (request.verbosity !== undefined) payload.text = { verbosity: request.verbosity }
  if (request.responseFormat) {
    payload.text = {
      ...payload.text,
      format: {
        type: 'json_schema',
        name: request.responseFormat.name || 'response_schema',
        schema: request.responseFormat.schema,
        strict: request.responseFormat.strict !== false,
      },
    }
  }
  if (prepared.tools?.length) payload.tools = prepared.tools

  const startTime = Date.now()
  const startTimeISO = new Date(startTime).toISOString()
  const tokens = { prompt: 0, completion: 0, total: 0 }
  const cost = createModelCost(request.model)
  const toolCalls: FunctionCallResponse[] = []
  const toolResults: Record<string, unknown>[] = []
  const timeSegments: TimeSegment[] = []
  let toolChoice = prepared.toolChoice
  let usedForcedTools: string[] = []
  let content = ''
  let modelTime = 0
  let toolsTime = 0
  let firstResponseTime = 0
  let iterations = 0
  const cancellation = new AbortController()
  const signal = request.abortSignal
    ? AbortSignal.any([request.abortSignal, cancellation.signal])
    : cancellation.signal
  const emitDeltas = !prepared.tools?.length || request.streamToolCalls

  const run = async (emit?: (text: string) => void): Promise<ProviderResponse> => {
    try {
      for (let round = 0; ; round++) {
        signal.throwIfAborted()
        const modelStart = Date.now()
        const body = {
          ...payload,
          input: [...input],
          ...(toolChoice
            ? {
                tool_choice:
                  typeof toolChoice === 'object' && toolChoice.type === 'function'
                    ? { type: 'function', name: toolChoice.function.name }
                    : toolChoice,
              }
            : {}),
        }
        let response: OpenAI.Responses.Response
        if (emit) {
          const events = await client.responses.create(
            { ...body, stream: true } as OpenAI.Responses.ResponseCreateParamsStreaming,
            { signal }
          )
          let terminal: OpenAI.Responses.Response | undefined
          for await (const event of events) {
            if (
              event.type === 'response.output_text.delta' ||
              event.type === 'response.refusal.delta'
            ) {
              if (emitDeltas) emit(event.delta)
            } else if (
              event.type === 'response.completed' ||
              event.type === 'response.incomplete' ||
              event.type === 'response.failed'
            ) {
              terminal = event.response
            } else if (event.type === 'error') {
              throw new Error(event.message)
            }
          }
          if (!terminal) throw new Error('OpenAI stream ended before a terminal response')
          response = terminal
        } else {
          response = await client.responses.create({ ...body, stream: false }, { signal })
        }
        const modelEnd = Date.now()
        const duration = modelEnd - modelStart
        if (iterations === 0) firstResponseTime = duration
        modelTime += duration
        iterations++
        timeSegments.push({
          type: 'model',
          name: `Model response ${iterations}`,
          startTime: modelStart,
          endTime: modelEnd,
          duration,
        })
        tokens.prompt += response.usage?.input_tokens ?? 0
        tokens.completion += response.usage?.output_tokens ?? 0
        tokens.total += response.usage?.total_tokens ?? 0
        cost.add(
          response.usage?.input_tokens ?? 0,
          response.usage?.output_tokens ?? 0,
          response.usage?.input_tokens_details?.cached_tokens ?? 0
        )

        const calls = response.output.filter((item) => item.type === 'function_call')
        if (response.error) throw new Error(response.error.message)
        if (
          response.status !== 'completed' &&
          !(
            response.status === 'incomplete' &&
            response.incomplete_details?.reason === 'max_output_tokens' &&
            calls.length === 0
          )
        ) {
          throw new Error(
            `OpenAI generation did not complete: ${response.incomplete_details?.reason ?? response.status}`
          )
        }
        content = response.output
          .flatMap((item) => (item.type === 'message' ? item.content : []))
          .map((part) => (part.type === 'output_text' ? part.text : part.refusal))
          .join('')
        if (!calls.length) {
          if (emit && !emitDeltas) emit(content)
          break
        }
        if (round >= MAX_TOOL_ITERATIONS)
          throw new Error('OpenAI exceeded the tool iteration limit')

        const tracking = trackForcedToolUsage(
          calls,
          toolChoice,
          logger,
          'openai',
          prepared.forcedTools,
          usedForcedTools
        )
        usedForcedTools = tracking.usedForcedTools
        toolChoice = tracking.nextToolChoice ?? undefined
        input.push(...response.output)
        for (const call of calls) {
          signal.throwIfAborted()
          const toolStart = Date.now()
          let args: Record<string, any> = {}
          let resultContent: Record<string, any>
          let success = false
          try {
            const tool = request.tools?.find(
              (tool) => tool.id === call.name && tool.usageControl !== 'none'
            )
            if (!tool) throw new Error(`Unknown OpenAI tool: ${call.name}`)
            const parsedArgs = JSON.parse(call.arguments)
            if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
              throw new Error(`Invalid arguments for OpenAI tool: ${call.name}`)
            }
            const { toolParams, executionParams } = prepareToolExecution(tool, parsedArgs, request)
            args = toolParams
            const result = await executeTool(call.name, executionParams)
            success = result.success
            resultContent = success
              ? result.output
              : { error: true, message: result.error || 'Tool execution failed', tool: call.name }
            if (success) toolResults.push(result.output)
          } catch (error) {
            resultContent = { error: true, message: toError(error).message, tool: call.name }
            logger.error('Error processing OpenAI tool call', { error, toolName: call.name })
          }
          input.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(resultContent),
          })
          const toolEnd = Date.now()
          const duration = toolEnd - toolStart
          toolsTime += duration
          toolCalls.push({
            id: call.call_id,
            name: call.name,
            arguments: args,
            startTime: new Date(toolStart).toISOString(),
            endTime: new Date(toolEnd).toISOString(),
            duration,
            result: resultContent,
            success,
          })
          timeSegments.push({
            type: 'tool',
            name: call.name,
            startTime: toolStart,
            endTime: toolEnd,
            duration,
          })
        }
      }
      const endTime = Date.now()
      return {
        content,
        model: request.model,
        tokens,
        cost: withToolCosts(cost.value, toolResults),
        toolCalls: toolCalls.length ? toolCalls : undefined,
        toolResults: toolResults.length ? toolResults : undefined,
        timing: {
          startTime: startTimeISO,
          endTime: new Date(endTime).toISOString(),
          duration: endTime - startTime,
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations,
          timeSegments,
        },
      }
    } catch (error) {
      const endTime = Date.now()
      logger.error('Error in OpenAI request', { error, duration: endTime - startTime })
      throw new ProviderError(toError(error).message, {
        startTime: startTimeISO,
        endTime: new Date(endTime).toISOString(),
        duration: endTime - startTime,
      })
    }
  }

  if (!request.stream) return run()

  const metadata = { startTime: startTimeISO, endTime: startTimeISO, duration: 0 }
  const streamingResult: StreamingExecution = {
    stream: new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const response = await run((text) => controller.enqueue(new TextEncoder().encode(text)))
          const { timing, toolCalls, ...output } = response
          Object.assign(streamingResult.execution.output, {
            ...output,
            toolCalls: toolCalls ? { list: toolCalls, count: toolCalls.length } : undefined,
            providerTiming: timing,
          })
          Object.assign(metadata, timing)
          controller.close()
        } catch (error) {
          streamingResult.execution.success = false
          streamingResult.execution.error = toError(error).message
          controller.error(error)
        }
      },
      cancel(reason) {
        cancellation.abort(reason)
      },
    }),
    execution: {
      success: true,
      output: { content: '', model: request.model, tokens, cost: cost.value },
      logs: [],
      metadata,
    },
  }
  return streamingResult
}
