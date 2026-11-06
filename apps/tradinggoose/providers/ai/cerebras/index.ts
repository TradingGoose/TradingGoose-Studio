import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { toError } from '@/providers/ai/error'
import type {
  ProviderConfig,
  ProviderErrorDetails,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/ai/types'
import {
  calculateCost,
  createOpenAICompatibleStream,
  prepareToolExecution,
  withToolCosts,
} from '@/providers/ai/utils'
import { executeTool } from '@/tools'

const logger = createLogger('CerebrasProvider')

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',

  /** Runs bounded tool rounds and returns Cerebras output with cumulative usage and cost. */
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Cerebras')
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()
    let getAccruedUsage: (() => ProviderErrorDetails) | undefined

    try {
      const client = new Cerebras({
        apiKey: request.apiKey,
      })

      // Start with an empty array for all messages
      const allMessages = []

      // Add system prompt if present
      if (request.systemPrompt) {
        allMessages.push({
          role: 'system',
          content: request.systemPrompt,
        })
      }

      // Add context if present
      if (request.context) {
        allMessages.push({
          role: 'user',
          content: request.context,
        })
      }

      // Add remaining messages
      if (request.messages) {
        allMessages.push(...request.messages)
      }

      // Transform tools to Cerebras format if provided
      const tools = request.tools?.length
        ? request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.id,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
        : undefined

      const selectedModel = request.model

      // Build the request payload
      const payload: any = {
        model: selectedModel.replace('cerebras/', ''),
        messages: allMessages,
      }

      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens
      if (request.reasoningEffort !== undefined) payload.reasoning_effort = request.reasoningEffort

      // Add response format for structured output if specified
      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          schema: request.responseFormat.schema,
        }
      }

      // Add tools if provided
      if (tools?.length) {
        // Filter out any tools with usageControl='none', treat 'force' as 'auto' since Cerebras only supports 'auto'
        const filteredTools = tools.filter((tool) => {
          const toolId = tool.function?.name
          const toolConfig = request.tools?.find((t) => t.id === toolId)
          // Only filter out tools with usageControl='none'
          return toolConfig?.usageControl !== 'none'
        })

        if (filteredTools?.length) {
          payload.tools = filteredTools
          // Always use 'auto' for Cerebras, explicitly converting any 'force' usageControl to 'auto'
          payload.tool_choice = 'auto'

          logger.info('Cerebras request configuration:', {
            toolCount: filteredTools.length,
            toolChoice: 'auto', // Cerebras always uses auto, 'force' is treated as 'auto'
            model: request.model,
          })
        } else if (tools.length > 0 && filteredTools.length === 0) {
          // Handle case where all tools are filtered out
          logger.info(`All tools have usageControl='none', removing tools from request`)
        }
      }

      // EARLY STREAMING: if streaming requested and no tools to execute, stream directly
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Cerebras request (no tools)')
        const streamResponse: any = await client.chat.completions.create({
          ...payload,
          stream: true,
        })

        // Start collecting token usage
        const tokenUsage = {
          prompt: 0,
          completion: 0,
          total: 0,
        }

        // Create a StreamingExecution response with a readable stream
        const streamingResult = {
          stream: createOpenAICompatibleStream(
            streamResponse as any,
            'Cerebras',
            (content, usage) => {
              const tokens = {
                prompt: usage.prompt_tokens,
                completion: usage.completion_tokens,
                total: usage.total_tokens,
              }
              streamingResult.execution.output.content = content
              streamingResult.execution.output.tokens = tokens
              streamingResult.execution.output.cost = calculateCost(
                request.model,
                tokens.prompt,
                tokens.completion
              )
            }
          ),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by streaming content in chat component
              model: selectedModel,
              tokens: tokenUsage,
              toolCalls: undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                timeSegments: [
                  {
                    type: 'model',
                    name: 'Streaming response',
                    startTime: providerStartTime,
                    endTime: Date.now(),
                    duration: Date.now() - providerStartTime,
                  },
                ],
              },
              cost: calculateCost(request.model),
            },
            logs: [], // No block logs for direct streaming
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        }

        // Return the streaming execution object
        return streamingResult as StreamingExecution
      }

      // Make the initial API request
      const initialCallTime = Date.now()

      const currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults: Record<string, unknown>[] = []
      getAccruedUsage = () => ({
        model: request.model,
        tokens,
        cost: withToolCosts(
          calculateCost(request.model, tokens.prompt, tokens.completion),
          toolResults
        ),
      })
      const currentMessages = [...allMessages]
      const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
      const iterationCount = toolCallsInResponse?.length ? 1 : 0

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track each model and tool call segment with timestamps
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      if (toolCallsInResponse?.length) {
        const processedToolCallIds = new Set<string>()
        const toolCallSignatures = new Set<string>()

        // Track time for tool calls in this batch
        const toolsStartTime = Date.now()
        const assistantMessage = currentResponse.choices[0].message
        currentMessages.push({
          role: 'assistant',
          content: assistantMessage.content ?? null,
          tool_calls: toolCallsInResponse,
        })

        // Process each tool call
        for (const toolCall of toolCallsInResponse) {
          const toolCallSignature = `${toolCall.function.name}-${toolCall.function.arguments}`
          if (processedToolCallIds.has(toolCall.id) || toolCallSignatures.has(toolCallSignature)) {
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: true,
                message: 'Repeated tool call was not executed',
                tool: toolCall.function.name,
              }),
            })
            continue
          }

          try {
            processedToolCallIds.add(toolCall.id)
            toolCallSignatures.add(toolCallSignature)

            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            // Get the tool from the tools registry
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) throw new Error(`Unknown tool: ${toolName}`)

            // Execute the tool
            const toolCallStartTime = Date.now()

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)

            const result = await executeTool(toolName, executionParams)
            const toolCallEndTime = Date.now()
            const toolCallDuration = toolCallEndTime - toolCallStartTime

            // Add to time segments for both success and failure
            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallDuration,
            })

            // Prepare result content for the LLM
            let resultContent: any
            if (result.success) {
              toolResults.push(result.output)
              resultContent = result.output
            } else {
              // Include error information so LLM can respond appropriately
              resultContent = {
                error: true,
                message: result.error || 'Tool execution failed',
                tool: toolName,
              }
            }

            toolCalls.push({
              name: toolName,
              arguments: toolParams,
              startTime: new Date(toolCallStartTime).toISOString(),
              endTime: new Date(toolCallEndTime).toISOString(),
              duration: toolCallDuration,
              result: resultContent,
              success: result.success,
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(resultContent),
            })
          } catch (error) {
            logger.error('Error processing tool call:', { error })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : String(error),
                tool: toolCall.function.name,
              }),
            })
          }
        }

        // Calculate tool call time for this iteration
        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        // After processing tool calls, get a final response
        if (!request.stream) {
          // Time the next model call
          const nextModelStartTime = Date.now()

          // Make the final request
          const finalPayload = {
            ...payload,
            messages: currentMessages,
          }

          // Use tool_choice: 'none' for the final response to avoid an infinite loop
          finalPayload.tool_choice = 'none'

          const finalResponse = (await client.chat.completions.create(
            finalPayload
          )) as CerebrasResponse

          const nextModelEndTime = Date.now()
          const thisModelTime = nextModelEndTime - nextModelStartTime

          // Add to time segments
          timeSegments.push({
            type: 'model',
            name: 'Final response',
            startTime: nextModelStartTime,
            endTime: nextModelEndTime,
            duration: thisModelTime,
          })

          // Add to model time
          modelTime += thisModelTime

          if (finalResponse.choices[0]?.message?.content) {
            content = finalResponse.choices[0].message.content
          }

          // Update final token counts
          if (finalResponse.usage) {
            tokens.prompt += finalResponse.usage.prompt_tokens || 0
            tokens.completion += finalResponse.usage.completion_tokens || 0
            tokens.total += finalResponse.usage.total_tokens || 0
          }
        }
      }
      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      // POST-TOOL-STREAMING: stream after tool calls if requested
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final Cerebras response after tool calls')

        // Disable tools for the final response after the completed tool batch.
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'none',
          stream: true,
        }

        const streamResponse: any = await client.chat.completions.create(streamingPayload)

        const previousTokens = { ...tokens }
        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createOpenAICompatibleStream(
            streamResponse as any,
            'Cerebras',
            (content, usage) => {
              const tokens = {
                prompt: previousTokens.prompt + usage.prompt_tokens,
                completion: previousTokens.completion + usage.completion_tokens,
                total: previousTokens.total + usage.total_tokens,
              }
              streamingResult.execution.output.content = content
              streamingResult.execution.output.tokens = tokens
              streamingResult.execution.output.cost = withToolCosts(
                calculateCost(request.model, tokens.prompt, tokens.completion),
                toolResults
              )
            }
          ),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: selectedModel,
              tokens: {
                prompt: tokens.prompt,
                completion: tokens.completion,
                total: tokens.total,
              },
              toolCalls:
                toolCalls.length > 0
                  ? {
                      list: toolCalls,
                      count: toolCalls.length,
                    }
                  : undefined,
              toolResults: toolResults.length > 0 ? toolResults : undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                modelTime: modelTime,
                toolsTime: toolsTime,
                firstResponseTime: firstResponseTime,
                iterations: iterationCount + 1,
                timeSegments: timeSegments,
              },
              cost: withToolCosts(
                calculateCost(request.model, tokens.prompt, tokens.completion),
                toolResults
              ),
            },
            logs: [], // No block logs at provider level
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        }

        // Return the streaming execution object
        return streamingResult as StreamingExecution
      }

      return {
        content,
        model: request.model,
        tokens,
        cost: calculateCost(request.model, tokens.prompt, tokens.completion),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Cerebras request:', {
        error,
        duration: totalDuration,
      })

      throw toError(error, {
        ...getAccruedUsage?.(),
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
        },
      })
    }
  },
}
