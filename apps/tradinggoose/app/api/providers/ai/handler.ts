import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeProviderRequest as executeAIProviderRequest } from '@/providers/ai'
import { getApiKey, getProvider } from '@/providers/ai/utils'

const logger = createLogger('ProvidersAPI:AI')

export interface ProviderRouteBody {
  provider?: string
  providerNamespace?: 'ai'
  providerType?: 'ai'
  model?: string
  fetcher?: string
  systemPrompt?: string
  context?: string
  tools?: any[]
  temperature?: number
  maxTokens?: number
  apiKey?: string
  azureEndpoint?: string
  azureApiVersion?: string
  responseFormat?: any
  workflowId?: string
  workspaceId?: string
  stream?: boolean
  messages?: any[]
  query?: Record<string, any>
  providerParams?: Record<string, any>
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  blockData?: Record<string, any>
  blockNameMapping?: Record<string, string>
  reasoningEffort?: string
  verbosity?: string
}

interface HandleAIProviderParams {
  body: ProviderRouteBody
  providerId: string
  requestId: string
  startTime: number
}

export async function handleAIProviderRequest({
  body,
  providerId,
  requestId,
  startTime,
}: HandleAIProviderParams) {
  const {
    model,
    systemPrompt,
    context,
    tools,
    temperature,
    maxTokens,
    apiKey,
    azureEndpoint,
    azureApiVersion,
    responseFormat,
    workflowId,
    workspaceId,
    stream,
    messages,
    environmentVariables,
    workflowVariables,
    blockData,
    blockNameMapping,
    reasoningEffort,
    verbosity,
  } = body

  const providerConfig = getProvider(providerId)
  const resolvedModel = model ?? providerConfig?.defaultModel
  if (!resolvedModel) {
    logger.warn(`[${requestId}] Model not specified for provider`, {
      provider: providerId,
    })
    return NextResponse.json({ error: 'Model is required' }, { status: 400 })
  }

  const resolvedSystemPrompt = systemPrompt ?? ''

  logger.info(`[${requestId}] Provider request details`, {
    provider: providerId,
    providerNamespace: 'ai',
    model: resolvedModel,
    hasSystemPrompt: !!systemPrompt,
    hasContext: !!context,
    hasTools: !!tools?.length,
    toolCount: tools?.length || 0,
    hasApiKey: !!apiKey,
    hasAzureEndpoint: !!azureEndpoint,
    hasAzureApiVersion: !!azureApiVersion,
    hasResponseFormat: !!responseFormat,
    workflowId,
    stream: !!stream,
    hasMessages: !!messages?.length,
    messageCount: messages?.length || 0,
    hasEnvironmentVariables: !!environmentVariables && Object.keys(environmentVariables).length > 0,
    hasWorkflowVariables: !!workflowVariables && Object.keys(workflowVariables).length > 0,
    reasoningEffort,
    verbosity,
  })

  let finalApiKey: string
  try {
    finalApiKey = getApiKey(providerId, resolvedModel, apiKey)
  } catch (error) {
    logger.error(`[${requestId}] Failed to get API key:`, {
      provider: providerId,
      model: resolvedModel,
      error: error instanceof Error ? error.message : String(error),
      hasProvidedApiKey: !!apiKey,
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'API key error' },
      { status: 400 }
    )
  }

  logger.info(`[${requestId}] Executing provider request`, {
    provider: providerId,
    model: resolvedModel,
    workflowId,
    hasApiKey: !!finalApiKey,
  })

  const response = await executeAIProviderRequest(providerId, {
    model: resolvedModel,
    systemPrompt: resolvedSystemPrompt,
    context,
    tools,
    temperature,
    maxTokens,
    apiKey: finalApiKey,
    azureEndpoint,
    azureApiVersion,
    responseFormat,
    workflowId,
    workspaceId,
    stream,
    messages,
    environmentVariables,
    workflowVariables,
    blockData,
    blockNameMapping,
    reasoningEffort,
    verbosity,
  })

  const executionTime = Date.now() - startTime
  logger.info(`[${requestId}] Provider request completed successfully`, {
    provider: providerId,
    model: resolvedModel,
    workflowId,
    executionTime,
    responseType:
      response instanceof ReadableStream
        ? 'stream'
        : response && typeof response === 'object' && 'stream' in response
          ? 'streaming-execution'
          : 'json',
  })

  if (response && typeof response === 'object' && 'stream' in response && 'execution' in response) {
    const streamingExec = response as StreamingExecution
    logger.info(`[${requestId}] Received StreamingExecution from provider`, {
      provider: providerId,
    })

    const streamObject = streamingExec.stream
    const executionData = streamingExec.execution

    let executionDataHeader
    try {
      const safeExecutionData = {
        success: executionData.success,
        output: {
          content: executionData.output?.content
            ? String(executionData.output.content).replace(/[\u0080-\uFFFF]/g, '')
            : '',
          model: executionData.output?.model,
          tokens: executionData.output?.tokens || {
            prompt: 0,
            completion: 0,
            total: 0,
          },
          toolCalls: executionData.output?.toolCalls
            ? sanitizeToolCalls(executionData.output.toolCalls)
            : undefined,
          providerTiming: executionData.output?.providerTiming,
          cost: executionData.output?.cost,
        },
        error: executionData.error,
        logs: [],
        metadata: {
          startTime: executionData.metadata?.startTime,
          endTime: executionData.metadata?.endTime,
          duration: executionData.metadata?.duration,
        },
        isStreaming: true,
        blockId: executionData.logs?.[0]?.blockId,
        blockName: executionData.logs?.[0]?.blockName,
        blockType: executionData.logs?.[0]?.blockType,
      }
      executionDataHeader = JSON.stringify(safeExecutionData)
    } catch (error) {
      logger.error(`[${requestId}] Failed to serialize execution data:`, error)
      executionDataHeader = JSON.stringify({
        success: executionData.success,
        error: 'Failed to serialize full execution data',
      })
    }

    return new Response(streamObject, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Execution-Data': executionDataHeader,
      },
    })
  }

  if (response instanceof ReadableStream) {
    logger.info(`[${requestId}] Streaming response from provider`, {
      provider: providerId,
    })
    return new Response(response, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  return NextResponse.json(response)
}

function sanitizeToolCalls(toolCalls: any) {
  if (toolCalls && typeof toolCalls === 'object' && Array.isArray(toolCalls.list)) {
    return {
      ...toolCalls,
      list: toolCalls.list.map(sanitizeToolCall),
    }
  }

  if (Array.isArray(toolCalls)) {
    return toolCalls.map(sanitizeToolCall)
  }

  return toolCalls
}

function sanitizeToolCall(toolCall: any) {
  if (!toolCall || typeof toolCall !== 'object') return toolCall

  const sanitized = { ...toolCall }

  if (typeof sanitized.name === 'string') {
    sanitized.name = sanitized.name.replace(/[\u0080-\uFFFF]/g, '')
  }

  if (sanitized.input && typeof sanitized.input === 'object') {
    sanitized.input = sanitizeObject(sanitized.input)
  }

  if (sanitized.arguments && typeof sanitized.arguments === 'object') {
    sanitized.arguments = sanitizeObject(sanitized.arguments)
  }

  if (sanitized.output && typeof sanitized.output === 'object') {
    sanitized.output = sanitizeObject(sanitized.output)
  }

  if (sanitized.result && typeof sanitized.result === 'object') {
    sanitized.result = sanitizeObject(sanitized.result)
  }

  if (typeof sanitized.error === 'string') {
    sanitized.error = sanitized.error.replace(/[\u0080-\uFFFF]/g, '')
  }

  return sanitized
}

function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item))
  }

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/[\u0080-\uFFFF]/g, '')
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value)
    } else {
      result[key] = value
    }
  }

  return result
}
