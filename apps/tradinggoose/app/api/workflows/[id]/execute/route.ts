import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  authenticateApiKeyFromHeader,
  updateApiKeyLastUsed,
} from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import {
  ExecutionGateError,
  enforceServerExecutionRateLimit,
} from '@/lib/execution/execution-concurrency-limit'
import { processExecutionFiles } from '@/lib/execution/files'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  runWorkflowExecution,
  WorkflowUsageLimitError,
} from '@/lib/workflows/execution-runner'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import {
  createHttpResponseFromBlock,
  workflowHasResponseBlock,
} from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/app/api/workflows/utils'
import { RateLimitError, type TriggerType } from '@/services/queue'

const logger = createLogger('WorkflowExecuteAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function createFilteredResult(result: any) {
  return {
    ...result,
    logs: undefined,
    metadata: result.metadata
      ? {
          ...result.metadata,
          workflowConnections: undefined,
        }
      : undefined,
  }
}

/**
 * Resolves output IDs to the internal blockId_attribute format
 * Supports both:
 * - User-facing format: blockName.path (e.g., "agent1.content")
 * - Internal format: blockId_attribute (e.g., "uuid_content") - used by chat deployments
 */
function resolveOutputIds(
  selectedOutputs: string[] | undefined,
  blocks: Record<string, any>,
): string[] | undefined {
  if (!selectedOutputs || selectedOutputs.length === 0) {
    return selectedOutputs
  }

  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  return selectedOutputs.map((outputId) => {
    if (UUID_REGEX.test(outputId)) {
      return outputId
    }

    const dotIndex = outputId.indexOf('.')
    if (dotIndex === -1) {
      logger.warn(`Invalid output ID format (missing dot): ${outputId}`)
      return outputId
    }

    const blockName = outputId.substring(0, dotIndex)
    const path = outputId.substring(dotIndex + 1)

    const normalizedBlockName = blockName.toLowerCase().replace(/\s+/g, '')
    const block = Object.values(blocks).find((b: any) => {
      const normalized = (b.name || '').toLowerCase().replace(/\s+/g, '')
      return normalized === normalizedBlockName
    })

    if (!block) {
      logger.warn(
        `Block not found for name: ${blockName} (from output ID: ${outputId})`,
      )
      return outputId
    }

    const resolvedId = `${block.id}_${path}`
    logger.debug(`Resolved output ID: ${outputId} -> ${resolvedId}`)
    return resolvedId
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] GET execution request for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id)
    if (validation.error) {
      logger.warn(
        `[${requestId}] Workflow access validation failed: ${validation.error.message}`,
      )
      return createErrorResponse(
        validation.error.message,
        validation.error.status,
      )
    }

    let triggerType: TriggerType = 'manual'
    const session = await getSession()
    if (!session?.user?.id) {
      const apiKeyHeader = request.headers.get('X-API-Key')
      if (apiKeyHeader) {
        triggerType = 'api'
      }
    }

    try {
      let actorUserId: string
      if (triggerType === 'manual') {
        actorUserId = session!.user!.id
      } else {
        const apiKeyHeader = request.headers.get('X-API-Key')
        const auth = apiKeyHeader
          ? await authenticateApiKeyFromHeader(apiKeyHeader)
          : null
        if (!auth?.success || !auth.userId) {
          return createErrorResponse('Unauthorized', 401)
        }
        actorUserId = auth.userId
        if (auth.keyId) {
          void updateApiKeyLastUsed(auth.keyId).catch(() => {})
        }
      }

      await enforceServerExecutionRateLimit({
        actorUserId,
        workflowId: validation.workflow.id,
        workspaceId: validation.workflow.workspaceId,
        isAsync: false,
        logger,
        requestId,
        source: 'workflow execution',
        triggerType,
      })

      const { result } = await runWorkflowExecution({
        workflowId: validation.workflow.id,
        workflowContext: validation.workflow,
        actorUserId,
        requestId,
        triggerType,
        workflowInput: undefined,
        start: {
          kind: 'trigger',
          triggerType: 'api',
        },
      })

      const hasResponseBlock = workflowHasResponseBlock(result)
      if (hasResponseBlock) {
        return createHttpResponseFromBlock(result)
      }

      const filteredResult = createFilteredResult(result)
      return createSuccessResponse(filteredResult)
    } catch (error: any) {
      if (error.message?.includes('Service overloaded')) {
        return createErrorResponse(
          'Service temporarily overloaded. Please try again later.',
          503,
          'SERVICE_OVERLOADED',
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${id}`, error)

    if (error instanceof RateLimitError) {
      return createErrorResponse(
        error.message,
        error.statusCode,
        'RATE_LIMIT_EXCEEDED',
      )
    }

    if (error instanceof ExecutionGateError) {
      return createErrorResponse(
        error.message,
        error.statusCode,
        'USAGE_LIMIT_EXCEEDED',
      )
    }

    if (error instanceof WorkflowUsageLimitError) {
      return createErrorResponse(
        error.message,
        error.statusCode,
        'USAGE_LIMIT_EXCEEDED',
      )
    }

    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR',
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = generateRequestId()
  const logger = createLogger('WorkflowExecuteAPI')
  logger.info(`[${requestId}] Raw request body: `)

  const { id } = await params
  const workflowId = id

  try {
    const validation = await validateWorkflowAccess(request as NextRequest, id)
    if (validation.error) {
      logger.warn(
        `[${requestId}] Workflow access validation failed: ${validation.error.message}`,
      )
      return createErrorResponse(
        validation.error.message,
        validation.error.status,
      )
    }

    const body = await request.text()
    logger.info(
      `[${requestId}] ${body ? 'Request body provided' : 'No request body provided'}`,
    )

    let parsedBody: any = {}
    if (body) {
      try {
        parsedBody = JSON.parse(body)
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to parse request body as JSON`,
          error,
        )
        return createErrorResponse('Invalid JSON in request body', 400)
      }
    }

    logger.info(`[${requestId}] Input passed to workflow:`, parsedBody)

    const sanitizeChatInputPayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return payload
      // Remove known control fields so they aren't treated as workflow input
      const {
        selectedOutputs: _selectedOutputs,
        stream: _stream,
        isSecureMode: _isSecureMode,
        workflowTriggerType: _workflowTriggerType,
        ...rest
      } = payload
      return rest
    }

    const extractExecutionParams = (req: NextRequest, body: any) => {
      const internalSecret = req.headers.get('X-Internal-Secret')
      const isInternalCall = internalSecret === env.INTERNAL_API_SECRET

      const resolvedTriggerType: TriggerType =
        body.workflowTriggerType ||
        (isInternalCall && body.stream ? 'chat' : 'api')

      const resolvedInput =
        resolvedTriggerType === 'chat'
          ? sanitizeChatInputPayload(body)
          : body.input !== undefined
            ? body.input
            : body

      return {
        isSecureMode:
          body.isSecureMode !== undefined ? body.isSecureMode : isInternalCall,
        streamResponse:
          req.headers.get('X-Stream-Response') === 'true' ||
          body.stream === true,
        selectedOutputs:
          body.selectedOutputs ||
          (req.headers.get('X-Selected-Outputs')
            ? JSON.parse(req.headers.get('X-Selected-Outputs')!)
            : undefined),
        workflowTriggerType: resolvedTriggerType,
        input: resolvedInput,
      }
    }

    const {
      isSecureMode: finalIsSecureMode,
      streamResponse,
      selectedOutputs,
      workflowTriggerType,
      input: rawInput,
    } = extractExecutionParams(request as NextRequest, parsedBody)

    // Generate executionId early so it can be used for file uploads
    const executionId = uuidv4()

    let processedInput = rawInput
    logger.info(
      `[${requestId}] Raw input received:`,
      JSON.stringify(rawInput, null, 2),
    )

    try {
      const deployedData = await loadDeployedWorkflowState(workflowId)
      const blocks = deployedData.blocks || {}
      logger.info(
        `[${requestId}] Loaded ${Object.keys(blocks).length} blocks from workflow`,
      )

      const apiTriggerBlock = Object.values(blocks).find(
        (block: any) => block.type === 'api_trigger',
      ) as any
      logger.info(`[${requestId}] API trigger block found:`, !!apiTriggerBlock)

      if (apiTriggerBlock?.subBlocks?.inputFormat?.value) {
        const inputFormat = apiTriggerBlock.subBlocks.inputFormat
          .value as Array<{
          name: string
          type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
        }>
        logger.info(
          `[${requestId}] Input format fields:`,
          inputFormat.map((f) => `${f.name}:${f.type}`).join(', '),
        )

        const fileFields = inputFormat.filter((field) => field.type === 'files')
        logger.info(
          `[${requestId}] Found ${fileFields.length} file-type fields`,
        )

        if (
          fileFields.length > 0 &&
          typeof rawInput === 'object' &&
          rawInput !== null
        ) {
          const executionContext = {
            workspaceId: validation.workflow.workspaceId,
            workflowId,
            executionId,
          }

          for (const fileField of fileFields) {
            const fieldValue = rawInput[fileField.name]

            if (fieldValue && typeof fieldValue === 'object') {
              const uploadedFiles = await processExecutionFiles(
                fieldValue,
                executionContext,
                requestId,
              )

              if (uploadedFiles.length > 0) {
                processedInput = {
                  ...processedInput,
                  [fileField.name]: uploadedFiles,
                }
                logger.info(
                  `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`,
                )
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to process file uploads:`, error)
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to process file uploads'
      return createErrorResponse(errorMessage, 400)
    }

    const input = processedInput

    let authenticatedUserId: string
    let triggerType: TriggerType = 'manual'

    if (finalIsSecureMode) {
      authenticatedUserId = validation.workflow.userId
      triggerType = 'manual'
    } else {
      const session = await getSession()
      const apiKeyHeader = request.headers.get('X-API-Key')

      if (session?.user?.id && !apiKeyHeader) {
        authenticatedUserId = session.user.id
        triggerType = 'manual'
      } else if (apiKeyHeader) {
        const auth = await authenticateApiKeyFromHeader(apiKeyHeader)
        if (!auth.success || !auth.userId) {
          return createErrorResponse('Unauthorized', 401)
        }
        authenticatedUserId = auth.userId
        triggerType = 'api'
        if (auth.keyId) {
          void updateApiKeyLastUsed(auth.keyId).catch(() => {})
        }
      } else {
        return createErrorResponse('Authentication required', 401)
      }
    }

    const workflowStartTriggerType =
      workflowTriggerType === 'chat' ? 'chat' : 'api'
    const executionTriggerType =
      workflowStartTriggerType === 'chat' ? 'chat' : triggerType

    try {
      await enforceServerExecutionRateLimit({
        actorUserId: authenticatedUserId,
        workflowId,
        workspaceId: validation.workflow.workspaceId,
        isAsync: false,
        logger,
        requestId,
        source: 'workflow execution',
        triggerType: executionTriggerType,
      })

      if (streamResponse) {
        const deployedData = await loadDeployedWorkflowState(workflowId)
        const resolvedSelectedOutputs = selectedOutputs
          ? resolveOutputIds(selectedOutputs, deployedData.blocks || {})
          : selectedOutputs

        const { createStreamingResponse } =
          await import('@/lib/workflows/streaming')
        const { SSE_HEADERS } = await import('@/lib/utils')

        const stream = await createStreamingResponse({
          requestId,
          workflow: validation.workflow,
          input,
          executingUserId: authenticatedUserId,
          streamConfig: {
            selectedOutputs: resolvedSelectedOutputs,
            workflowTriggerType: workflowStartTriggerType,
          },
          executionId,
        })

        return new NextResponse(stream, {
          status: 200,
          headers: SSE_HEADERS,
        })
      }

      const { result } = await runWorkflowExecution({
        workflowId,
        workflowContext: validation.workflow,
        actorUserId: authenticatedUserId,
        requestId,
        executionId,
        triggerType: executionTriggerType,
        workflowInput: input,
        start: {
          kind: 'trigger',
          triggerType: workflowStartTriggerType,
        },
      })

      const hasResponseBlock = workflowHasResponseBlock(result)
      if (hasResponseBlock) {
        return createHttpResponseFromBlock(result)
      }

      const filteredResult = createFilteredResult(result)
      return createSuccessResponse(filteredResult)
    } catch (error: any) {
      if (error.message?.includes('Service overloaded')) {
        return createErrorResponse(
          'Service temporarily overloaded. Please try again later.',
          503,
          'SERVICE_OVERLOADED',
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(
      `[${requestId}] Error executing workflow: ${workflowId}`,
      error,
    )

    if (error instanceof RateLimitError) {
      return createErrorResponse(
        error.message,
        error.statusCode,
        'RATE_LIMIT_EXCEEDED',
      )
    }

    if (error instanceof ExecutionGateError) {
      return createErrorResponse(
        error.message,
        error.statusCode,
        'USAGE_LIMIT_EXCEEDED',
      )
    }

    if (error instanceof WorkflowUsageLimitError) {
      return createErrorResponse(
        error.message,
        error.statusCode,
        'USAGE_LIMIT_EXCEEDED',
      )
    }

    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR',
    )
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-API-Key, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version',
      'Access-Control-Max-Age': '86400',
    },
  })
}
