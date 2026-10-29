import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { SSE_HEADERS } from '@/lib/utils'
import type { ExecutionSubmissionSource, StreamingExecution } from '@/executor/types'
import { executeProviderRequest as executeAIProviderRequest } from '@/providers/ai'
import { encodeProviderStream } from '@/providers/ai/streaming'
import { getApiKey } from '@/providers/ai/utils-server'

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
  vertexProject?: string
  vertexLocation?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
  responseFormat?: any
  workflowId?: string
  workspaceId?: string
  workflowLogId?: string
  submissionSource?: ExecutionSubmissionSource
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
  thinkingLevel?: string
  isDeployedContext?: boolean
}

interface HandleAIProviderParams {
  body: ProviderRouteBody
  providerId: string
  requestId: string
  startTime: number
  authUserId?: string
}

export async function handleAIProviderRequest({
  body,
  providerId,
  requestId,
  startTime,
  authUserId,
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
    vertexProject,
    vertexLocation,
    bedrockAccessKeyId,
    bedrockSecretKey,
    bedrockRegion,
    responseFormat,
    workflowId,
    workspaceId,
    workflowLogId,
    submissionSource,
    stream,
    messages,
    environmentVariables,
    workflowVariables,
    blockData,
    blockNameMapping,
    reasoningEffort,
    verbosity,
    thinkingLevel,
    isDeployedContext,
  } = body

  if (!model) {
    logger.warn(`[${requestId}] Model not specified for provider`, {
      provider: providerId,
    })
    return NextResponse.json({ error: 'Model is required' }, { status: 400 })
  }

  logger.info(`[${requestId}] Provider request details`, {
    provider: providerId,
    providerNamespace: 'ai',
    model: model,
    hasSystemPrompt: !!systemPrompt,
    hasContext: !!context,
    hasTools: !!tools?.length,
    toolCount: tools?.length || 0,
    hasApiKey: !!apiKey,
    hasAzureEndpoint: !!azureEndpoint,
    hasAzureApiVersion: !!azureApiVersion,
    hasVertexProject: !!vertexProject,
    hasVertexLocation: !!vertexLocation,
    hasBedrockAccessKeyId: !!bedrockAccessKeyId,
    hasBedrockSecretKey: !!bedrockSecretKey,
    hasBedrockRegion: !!bedrockRegion,
    hasResponseFormat: !!responseFormat,
    workflowId,
    stream: !!stream,
    hasMessages: !!messages?.length,
    messageCount: messages?.length || 0,
    hasEnvironmentVariables: !!environmentVariables && Object.keys(environmentVariables).length > 0,
    hasWorkflowVariables: !!workflowVariables && Object.keys(workflowVariables).length > 0,
    reasoningEffort,
    verbosity,
    thinkingLevel,
  })

  let finalApiKey: string
  try {
    finalApiKey = await getApiKey(providerId, model, apiKey)
  } catch (error) {
    logger.error(`[${requestId}] Failed to get API key:`, {
      provider: providerId,
      model: model,
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
    model: model,
    workflowId,
    hasApiKey: !!finalApiKey,
  })

  const response = await executeAIProviderRequest(providerId, {
    model: model,
    systemPrompt,
    context,
    tools,
    temperature,
    maxTokens,
    apiKey: finalApiKey,
    azureEndpoint,
    azureApiVersion,
    vertexProject,
    vertexLocation,
    bedrockAccessKeyId,
    bedrockSecretKey,
    bedrockRegion,
    responseFormat,
    workflowId,
    workspaceId,
    workflowLogId,
    submissionSource,
    userId: authUserId,
    stream,
    messages,
    environmentVariables,
    workflowVariables,
    blockData,
    blockNameMapping,
    reasoningEffort,
    verbosity,
    thinkingLevel,
    isDeployedContext,
  })

  const executionTime = Date.now() - startTime
  logger.info(`[${requestId}] Provider request completed successfully`, {
    provider: providerId,
    model: model,
    workflowId,
    executionTime,
    responseType: 'stream' in response ? 'streaming-execution' : 'json',
  })

  if (response && typeof response === 'object' && 'stream' in response && 'execution' in response) {
    const streamingExec = response as StreamingExecution
    logger.info(`[${requestId}] Received StreamingExecution from provider`, {
      provider: providerId,
    })

    return new Response(encodeProviderStream(streamingExec), { headers: SSE_HEADERS })
  }

  return NextResponse.json(response)
}
