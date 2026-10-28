import { Groq } from 'groq-sdk'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/ai/models'
import type {
  ProviderConfig,
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

const logger = createLogger('GroqProvider')

export const groqProvider: ProviderConfig = {
  id: 'groq',
  name: 'Groq',
  description: "Groq's LLM models with high-performance inference",
  version: '1.0.0',
  models: getProviderModels('groq'),
  defaultModel: getProviderDefaultModel('groq'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Groq')
    }

    // Create Groq client
    const groq = new Groq({ apiKey: request.apiKey })

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

    // Transform tools to function format if provided
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

    // Build the request payload
    const payload: any = {
      model: request.model.replace('groq/', ''),
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens
    if (request.reasoningEffort !== undefined) payload.reasoning_effort = request.reasoningEffort
    if (payload.model.startsWith('qwen/') && request.thinkingLevel === 'enabled') {
      payload.reasoning_effort = 'default'
      payload.reasoning_format = 'parsed'
    }

    // Add response format for structured output if specified
    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        schema: request.responseFormat.schema,
      }
    }

    // Handle tools and tool usage control
    if (tools?.length) {
      // Filter out any tools with usageControl='none', but ignore 'force' since Groq doesn't support it
      const filteredTools = tools.filter((tool) => {
        const toolId = tool.function?.name
        const toolConfig = request.tools?.find((t) => t.id === toolId)
        // Only filter out 'none', treat 'force' as 'auto'
        return toolConfig?.usageControl !== 'none'
      })

      if (filteredTools?.length) {
        payload.tools = filteredTools
        // Always use 'auto' for Groq, regardless of the tool_choice setting
        payload.tool_choice = 'auto'

        logger.info('Groq request configuration:', {
          toolCount: filteredTools.length,
          toolChoice: 'auto', // Groq always uses auto
          model: request.model,
        })
      }
    }

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion.
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('Using streaming response for Groq request (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const streamResponse = await groq.chat.completions.create({
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
        stream: createOpenAICompatibleStream(streamResponse as any, 'Groq', (content, usage) => {
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
            tokens.completion,
            !!request.context
          )
        }),
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content in chat component
            model: request.model,
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

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Make the initial API request
      const initialCallTime = Date.now()

      let currentResponse = await groq.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults: Record<string, unknown>[] = []
      const currentMessages = [...allMessages]
      let iterationCount = 0
      const MAX_ITERATIONS = 10 // Prevent infinite loops

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

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

          // Track time for tool calls in this batch
          const toolsStartTime = Date.now()

          // Process each tool call
          for (const toolCall of toolCallsInResponse) {
            try {
              const toolName = toolCall.function.name
              const toolArgs = JSON.parse(toolCall.function.arguments)

              // Get the tool from the tools registry
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) continue

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

              // Add the tool call and result to messages (both success and failure)
              currentMessages.push({
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: toolCall.id,
                    type: 'function',
                    function: {
                      name: toolName,
                      arguments: toolCall.function.arguments,
                    },
                  },
                ],
              })

              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(resultContent),
              })
            } catch (error) {
              logger.error('Error processing tool call:', { error })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          // Make the next request with updated messages
          const nextPayload = {
            ...payload,
            messages: currentMessages,
          }

          // Time the next model call
          const nextModelStartTime = Date.now()

          // Make the next request
          currentResponse = await groq.chat.completions.create(nextPayload)

          const nextModelEndTime = Date.now()
          const thisModelTime = nextModelEndTime - nextModelStartTime

          // Add to time segments
          timeSegments.push({
            type: 'model',
            name: `Model response (iteration ${iterationCount + 1})`,
            startTime: nextModelStartTime,
            endTime: nextModelEndTime,
            duration: thisModelTime,
          })

          // Add to model time
          modelTime += thisModelTime

          // Update content if we have a text response
          if (currentResponse.choices[0]?.message?.content) {
            content = currentResponse.choices[0].message.content
          }

          // Update token counts
          if (currentResponse.usage) {
            tokens.prompt += currentResponse.usage.prompt_tokens || 0
            tokens.completion += currentResponse.usage.completion_tokens || 0
            tokens.total += currentResponse.usage.total_tokens || 0
          }

          iterationCount++
        }
      } catch (error) {
        logger.error('Error in Groq request:', { error })
      }

      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final Groq response after tool calls')

        // When streaming after tool calls with forced tools, make sure tool_choice is set to 'auto'
        // This prevents the API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
        }

        const streamResponse = await groq.chat.completions.create(streamingPayload)

        const previousTokens = { ...tokens }
        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createOpenAICompatibleStream(streamResponse as any, 'Groq', (content, usage) => {
            const tokens = {
              prompt: previousTokens.prompt + usage.prompt_tokens,
              completion: previousTokens.completion + usage.completion_tokens,
              total: previousTokens.total + usage.total_tokens,
            }
            streamingResult.execution.output.content = content
            streamingResult.execution.output.tokens = tokens
            streamingResult.execution.output.cost = withToolCosts(
              calculateCost(request.model, tokens.prompt, tokens.completion, !!request.context),
              toolResults
            )
          }),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model,
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
                calculateCost(request.model, tokens.prompt, tokens.completion, !!request.context),
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

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      return {
        content,
        model: request.model,
        tokens,
        cost: calculateCost(request.model, tokens.prompt, tokens.completion, !!request.context),
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

      logger.error('Error in Groq request:', {
        error,
        duration: totalDuration,
      })

      // Create a new error with timing information
      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore - Adding timing property to the error
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  },
}
