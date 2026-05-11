import { db } from '@tradinggoose/db'
import { chat, workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { isExecutionResult } from '@/lib/workflows/execution-result'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  traverseObjectPath,
} from '@/lib/response-format'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { ChatFiles } from '@/lib/uploads'
import { encodeSSE, generateRequestId, SSE_HEADERS } from '@/lib/utils'
import type { BlockLog, ExecutionResult } from '@/executor/types'
import {
  addCorsHeaders,
  setChatAuthCookie,
  validateAuthToken,
  validateChatAuth,
} from '@/app/api/chat/utils'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/app/api/workflows/utils'

const logger = createLogger('ChatIdentifierAPI')
const CHAT_QUEUE_POLL_INTERVAL_MS = 500

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function formatChatContent(value: unknown) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value, null, 2)
}

function resolveSelectedChatOutput(result: ExecutionResult, selectedOutputs: string[]) {
  const output: string[] = []

  for (const outputId of selectedOutputs) {
    const blockId = extractBlockIdFromOutputId(outputId)
    const path = extractPathFromOutputId(outputId, blockId)
    const log = result.logs?.find((entry: BlockLog) => entry.blockId === blockId)
    if (!log) continue

    const value = path ? traverseObjectPath(log.output, path) : log.output
    const content = formatChatContent(value)
    if (content) {
      output.push(content)
    }
  }

  return output.join('\n\n')
}

function selectedOutputsForBlock(selectedOutputs: string[], blockId: string) {
  return selectedOutputs.filter((outputId) => extractBlockIdFromOutputId(outputId) === blockId)
}

function canStreamSelectedBlock(selectedOutputs: string[], blockId: string) {
  if (selectedOutputs.length === 0) return true
  return selectedOutputsForBlock(selectedOutputs, blockId).some((outputId) => {
    const path = extractPathFromOutputId(outputId, blockId)
    return !path || path === 'content'
  })
}

function resolveSelectedBlockOutput(params: {
  blockId: string
  output: unknown
  selectedOutputs: string[]
}) {
  if (params.selectedOutputs.length === 0) {
    return formatChatContent(params.output)
  }

  return selectedOutputsForBlock(params.selectedOutputs, params.blockId)
    .map((outputId) => {
      const path = extractPathFromOutputId(outputId, params.blockId)
      const value = path ? traverseObjectPath(params.output, path) : params.output
      return formatChatContent(value)
    })
    .filter(Boolean)
    .join('\n\n')
}

function createQueuedChatStream(params: {
  taskId: string
  workflowId: string
  selectedOutputs: string[]
  requestId: string
}) {
  return new ReadableStream({
    async start(controller) {
      let lastEventId = 0
      let emittedContent = false
      const streamedBlocks = new Set<string>()

      try {
        while (true) {
          const state = await readWorkflowExecutionEventState({
            pendingExecutionId: params.taskId,
            workflowId: params.workflowId,
            afterEventId: lastEventId,
          })

          if (!state) {
            throw new Error('Queued chat execution was not found')
          }

          for (const entry of state.events) {
            lastEventId = entry.eventId
            const event = entry.event

            if (event.type === 'stream:chunk') {
              if (canStreamSelectedBlock(params.selectedOutputs, event.data.blockId)) {
                streamedBlocks.add(event.data.blockId)
                emittedContent = true
                controller.enqueue(
                  encodeSSE({
                    blockId: event.data.blockId,
                    chunk: event.data.chunk,
                  })
                )
              }
              continue
            }

            if (event.type === 'block:completed') {
              if (!streamedBlocks.has(event.data.blockId)) {
                const content = resolveSelectedBlockOutput({
                  blockId: event.data.blockId,
                  output: event.data.output,
                  selectedOutputs: params.selectedOutputs,
                })
                if (content) {
                  emittedContent = true
                  controller.enqueue(encodeSSE({ blockId: event.data.blockId, chunk: content }))
                }
              }
              continue
            }

            if (event.type === 'execution:completed') {
              const result = event.data.result
              if (!isExecutionResult(result)) {
                throw new Error('Queued chat execution result is missing')
              }

              if (!emittedContent) {
                const content = params.selectedOutputs.length
                  ? resolveSelectedChatOutput(result, params.selectedOutputs)
                  : formatChatContent(result.output)
                if (content) {
                  controller.enqueue(encodeSSE({ blockId: 'workflow', chunk: content }))
                }
              }

              controller.enqueue(encodeSSE({ event: 'final', data: result }))
              controller.close()
              return
            }

            if (event.type === 'execution:error') {
              controller.enqueue(
                encodeSSE({
                  event: 'error',
                  error: event.data.error || 'Chat workflow execution failed',
                })
              )
              controller.close()
              return
            }

            if (event.type === 'execution:cancelled') {
              controller.enqueue(
                encodeSSE({
                  event: 'error',
                  error: 'Chat workflow execution was cancelled',
                })
              )
              controller.close()
              return
            }
          }

          if (state.status === 'failed') {
            throw new Error(state.errorMessage ?? 'Chat workflow execution failed')
          }

          if (state.status === 'completed') {
            throw new Error('Queued chat execution completed without a terminal stream event')
          }

          await sleep(CHAT_QUEUE_POLL_INTERVAL_MS)
        }
      } catch (error) {
        logger.error(`[${params.requestId}] Queued chat stream failed`, error)
        controller.enqueue(
          encodeSSE({
            event: 'error',
            error: error instanceof Error ? error.message : 'Chat workflow execution failed',
          })
        )
        controller.close()
      }
    },
  })
}

// This endpoint handles chat interactions via the identifier
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(
      `[${requestId}] Processing chat request for identifier: ${identifier}`,
    )

    // Parse the request body once
    let parsedBody
    try {
      parsedBody = await request.json()
    } catch (_error) {
      return addCorsHeaders(
        createErrorResponse('Invalid request body', 400),
        request,
      )
    }

    // Find the chat deployment for this identifier
    const deploymentResult = await db
      .select({
        id: chat.id,
        workflowId: chat.workflowId,
        userId: chat.userId,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
      })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    // Check if the chat is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
      return addCorsHeaders(
        createErrorResponse('This chat is currently unavailable', 403),
        request,
      )
    }

    // Validate authentication with the parsed body
    const authResult = await validateChatAuth(
      requestId,
      deployment,
      request,
      parsedBody,
    )
    if (!authResult.authorized) {
      return addCorsHeaders(
        createErrorResponse(authResult.error || 'Authentication required', 401),
        request,
      )
    }

    // Use the already parsed body
    const { input, password, email, conversationId, files } = parsedBody

    // If this is an authentication request (has password or email but no input),
    // set auth cookie and return success
    if ((password || email) && !input) {
      const response = addCorsHeaders(
        createSuccessResponse({ authenticated: true }),
        request,
      )

      // Set authentication cookie
      setChatAuthCookie(response, deployment.id, deployment.authType)

      return response
    }

    // For chat messages, create regular response (allow empty input if files are present)
    if (!input && (!files || files.length === 0)) {
      return addCorsHeaders(
        createErrorResponse('No input provided', 400),
        request,
      )
    }

    // Get the workflow for this chat
    const workflowResult = await db
      .select({
        isDeployed: workflow.isDeployed,
        workspaceId: workflow.workspaceId,
        variables: workflow.variables,
        pinnedApiKeyId: workflow.pinnedApiKeyId,
      })
      .from(workflow)
      .where(eq(workflow.id, deployment.workflowId))
      .limit(1)

    if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
      logger.warn(
        `[${requestId}] Workflow not found or not deployed: ${deployment.workflowId}`,
      )
      return addCorsHeaders(
        createErrorResponse('Chat workflow is not available', 503),
        request,
      )
    }

    const executingUserId = await getApiKeyOwnerUserId(
      workflowResult[0].pinnedApiKeyId,
    )
    if (!executingUserId) {
      logger.warn(
        `[${requestId}] Chat deployment missing valid pinned API key for billing attribution: ${deployment.workflowId}`,
      )
      return addCorsHeaders(
        createErrorResponse(
          'API key is required. Please create or select an API key before deploying.',
          503,
        ),
        request,
      )
    }

    try {
      const selectedOutputs: string[] = []
      if (deployment.outputConfigs && Array.isArray(deployment.outputConfigs)) {
        for (const config of deployment.outputConfigs) {
          const outputId = config.path
            ? `${config.blockId}_${config.path}`
            : `${config.blockId}_content`
          selectedOutputs.push(outputId)
        }
      }

      // Generate executionId early so it can be used for file uploads and workflow execution
      const executionId = crypto.randomUUID()
      const workspaceId = workflowResult[0].workspaceId

      if (!workspaceId) {
        logger.warn(
          `[${requestId}] Chat workflow is missing a workspace: ${deployment.workflowId}`,
        )
        return addCorsHeaders(
          createErrorResponse('Chat workflow is not available', 503),
          request,
        )
      }

      const workflowInput: any = { input, conversationId }
      if (files && Array.isArray(files) && files.length > 0) {
        logger.debug(`[${requestId}] Processing ${files.length} attached files`)

        const executionContext = {
          workspaceId,
          workflowId: deployment.workflowId,
          executionId,
        }

        const uploadedFiles = await ChatFiles.processChatFiles(
          files,
          executionContext,
          requestId,
        )

        if (uploadedFiles.length > 0) {
          workflowInput.files = uploadedFiles
          logger.info(
            `[${requestId}] Successfully processed ${uploadedFiles.length} files`,
          )
        }
      }

      const handle = await enqueuePendingExecution({
        executionType: 'workflow',
        pendingExecutionId: executionId,
        workflowId: deployment.workflowId,
        workspaceId,
        userId: executingUserId,
        source: 'published_chat',
        requestId,
        payload: {
          executionId,
          workflowId: deployment.workflowId,
          userId: executingUserId,
          workspaceId,
          input: workflowInput,
          triggerType: 'chat',
          executionTarget: 'deployed',
          selectedOutputs,
          workflowVariables:
            workflowResult[0].variables && typeof workflowResult[0].variables === 'object'
              ? (workflowResult[0].variables as Record<string, unknown>)
              : undefined,
          metadata: {
            source: 'published_chat',
            chatId: deployment.id,
          },
        },
      })

      const stream = createQueuedChatStream({
        taskId: handle.pendingExecutionId,
        workflowId: deployment.workflowId,
        selectedOutputs,
        requestId,
      })
      const streamResponse = new NextResponse(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
      return addCorsHeaders(streamResponse, request)
    } catch (error: any) {
      if (isPendingExecutionLimitError(error)) {
        return addCorsHeaders(
          createErrorResponse('Pending execution backlog is full', error.statusCode),
          request
        )
      }

      if (error instanceof TriggerExecutionUnavailableError) {
        return addCorsHeaders(createErrorResponse(error.message, error.statusCode), request)
      }

      logger.error(`[${requestId}] Error processing chat request:`, error)
      return addCorsHeaders(
        createErrorResponse(error.message || 'Failed to process request', 500),
        request,
      )
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing chat request:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process request', 500),
      request,
    )
  }
}

// This endpoint returns information about the chat
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(
      `[${requestId}] Fetching chat info for identifier: ${identifier}`,
    )

    // Find the chat deployment for this identifier
    const deploymentResult = await db
      .select({
        id: chat.id,
        title: chat.title,
        description: chat.description,
        customizations: chat.customizations,
        isActive: chat.isActive,
        workflowId: chat.workflowId,
        authType: chat.authType,
        password: chat.password,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
      })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    // Check if the chat is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
      return addCorsHeaders(
        createErrorResponse('This chat is currently unavailable', 403),
        request,
      )
    }

    // Check for auth cookie first
    const cookieName = `chat_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)

    if (
      deployment.authType !== 'public' &&
      authCookie &&
      validateAuthToken(authCookie.value, deployment.id)
    ) {
      // Cookie valid, return chat info
      return addCorsHeaders(
        createSuccessResponse({
          id: deployment.id,
          title: deployment.title,
          description: deployment.description,
          customizations: deployment.customizations,
          authType: deployment.authType,
          outputConfigs: deployment.outputConfigs,
        }),
        request,
      )
    }

    // If no valid cookie, proceed with standard auth check
    const authResult = await validateChatAuth(requestId, deployment, request)
    if (!authResult.authorized) {
      logger.info(
        `[${requestId}] Authentication required for chat: ${identifier}, type: ${deployment.authType}`,
      )
      return addCorsHeaders(
        createErrorResponse(authResult.error || 'Authentication required', 401),
        request,
      )
    }

    // Return public information about the chat including auth type
    return addCorsHeaders(
      createSuccessResponse({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description,
        customizations: deployment.customizations,
        authType: deployment.authType,
        outputConfigs: deployment.outputConfigs,
      }),
      request,
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching chat info:`, error)
    return addCorsHeaders(
      createErrorResponse(
        error.message || 'Failed to fetch chat information',
        500,
      ),
      request,
    )
  }
}
