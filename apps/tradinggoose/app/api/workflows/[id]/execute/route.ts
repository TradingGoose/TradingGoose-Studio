import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { AuthType } from '@/lib/auth/hybrid'
import {
  ExecutionGateError,
  enforceServerExecutionRateLimit,
} from '@/lib/execution/execution-concurrency-limit'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { openWorkflowExecutionEventStream } from '@/lib/execution/workflow-execution-stream'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { encodeSSE, generateRequestId, SSE_HEADERS } from '@/lib/utils'
import { createChatOutputEventReader } from '@/lib/workflows/chat-output'
import { createPublicExecutionResult, isExecutionResult } from '@/lib/workflows/execution-result'
import type { WorkflowExecutionEventEntry } from '@/lib/workflows/execution-events'
import { processDeployedApiTriggerInputFiles } from '@/lib/workflows/input-format-files'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import type { ExecutionResult } from '@/executor/types'
import { RateLimitError } from '@/services/queue'

const logger = createLogger('WorkflowExecuteAPI')
const API_EXECUTION_POLL_INTERVAL_MS = 1_000
const API_EXECUTION_WAIT_TIMEOUT_MS = 25 * 1000
const UNSUPPORTED_API_EXECUTE_FIELDS = [
  'workflowTriggerType',
  'isSecureMode',
  'useDraftState',
  'isClientSession',
  'workflowData',
  'workflowStateOverride',
  'workflowVariables',
  'startBlockId',
  'executionId',
] as const

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForApiWorkflowResult(params: {
  executionId: string
  workflowId: string
}): Promise<{ status: 'completed'; result: ExecutionResult } | { status: 'queued' }> {
  const startedAt = Date.now()

  const readTerminalResult = async () => {
    const state = await readWorkflowExecutionEventState({
      pendingExecutionId: params.executionId,
      workflowId: params.workflowId,
    })

    if (!state) {
      throw new Error('Queued workflow execution was not found')
    }

    if (state.status === 'completed') {
      if (!isExecutionResult(state.result)) {
        throw new Error('Queued workflow execution result is missing')
      }
      return { status: 'completed' as const, result: state.result }
    }

    if (state.status === 'failed') {
      throw new Error(state.errorMessage || 'Workflow execution failed')
    }

    return null
  }

  while (Date.now() - startedAt < API_EXECUTION_WAIT_TIMEOUT_MS) {
    const result = await readTerminalResult()
    if (result) return result

    await sleep(API_EXECUTION_POLL_INTERVAL_MS)
  }

  const finalResult = await readTerminalResult()
  if (finalResult) return finalResult

  return { status: 'queued' }
}

function createApiWorkflowResponse(result: ExecutionResult) {
  if (workflowHasResponseBlock(result)) {
    return createHttpResponseFromBlock(result)
  }

  return createSuccessResponse(createPublicExecutionResult(result))
}

function findUnsupportedApiExecuteField(body: Record<string, unknown>) {
  return UNSUPPORTED_API_EXECUTE_FIELDS.find((field) => body[field] !== undefined)
}

function resolveSelectedOutputs(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return null
  }
  return value as string[]
}

function resolveWorkflowInput(body: Record<string, unknown>) {
  const { stream: _stream, selectedOutputs: _selectedOutputs, ...bodyInput } = body
  const input = body.input !== undefined ? body.input : bodyInput
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return createErrorResponse('Workflow input must be an object', 400)
  }

  return input as Record<string, unknown>
}

function createApiWorkflowStreamFormatter(selectedOutputs: string[]) {
  const outputReader = createChatOutputEventReader(selectedOutputs)
  return (entry: WorkflowExecutionEventEntry) =>
    outputReader.readEvent(entry.event).map((event) => {
      if (event.type === 'content') {
        return encodeSSE({ blockId: event.blockId, chunk: event.content })
      }
      if (event.type === 'error') {
        return encodeSSE({ event: 'error', blockId: event.blockId, error: event.message })
      }
      return encodeSSE({ event: 'final', data: { success: event.success } })
    })
}

function createQueuedApiWorkflowResponse(params: {
  executionId: string
  workflowName: string
  createdAt: string
}) {
  return NextResponse.json(
    {
      success: true,
      taskId: params.executionId,
      executionId: params.executionId,
      workflowName: params.workflowName,
      status: 'queued',
      createdAt: params.createdAt,
      links: {
        status: `/api/jobs/${params.executionId}`,
      },
    },
    { status: 202 }
  )
}

async function executeApiWorkflowThroughQueue(params: {
  request: NextRequest
  workflowId: string
  input: Record<string, unknown>
  requestId: string
  stream: boolean
  selectedOutputs: string[]
}) {
  const validation = await validateWorkflowAccess(params.request, params.workflowId)
  if (validation.error || !validation.workflow) {
    return createErrorResponse(
      validation.error?.message ?? 'Workflow not found',
      validation.error?.status ?? 404
    )
  }

  const apiKeyAuth = validation.apiKeyAuth
  if (!apiKeyAuth?.success || !apiKeyAuth.userId) {
    return createErrorResponse('Unauthorized', 401)
  }

  const apiUserId = apiKeyAuth.userId
  const executionId = `workflow_execution_${randomUUID()}`
  const createdAt = new Date().toISOString()

  await enforceServerExecutionRateLimit({
    actorUserId: apiUserId,
    authType: AuthType.API_KEY,
    workflowId: validation.workflow.id,
    workspaceId: validation.workflow.workspaceId,
    isAsync: false,
    logger,
    requestId: params.requestId,
    source: 'workflow execution',
    triggerType: 'api',
  })

  const input = await processDeployedApiTriggerInputFiles({
    input: params.input,
    workspaceId: validation.workflow.workspaceId,
    workflowId: validation.workflow.id,
    executionId,
    requestId: params.requestId,
  })

  await enqueuePendingExecution({
    executionType: 'workflow',
    pendingExecutionId: executionId,
    workflowId: validation.workflow.id,
    workspaceId: validation.workflow.workspaceId,
    userId: apiUserId,
    source: 'workflow_execute_api',
    requestId: params.requestId,
    payload: {
      executionId,
      workflowId: validation.workflow.id,
      userId: apiUserId,
      workspaceId: validation.workflow.workspaceId,
      input,
      triggerType: 'api',
      executionTarget: 'deployed',
      selectedOutputs: params.selectedOutputs,
      metadata: {
        source: 'workflow_execute_api',
        apiKeyId: apiKeyAuth.keyId ?? null,
      },
    },
  })

  if (params.stream) {
    const streamResult = await openWorkflowExecutionEventStream({
      pendingExecutionId: executionId,
      workflowId: validation.workflow.id,
      requestId: params.requestId,
      formatEvent: createApiWorkflowStreamFormatter(params.selectedOutputs),
      formatError: (error) =>
        encodeSSE({
          event: 'error',
          error: error instanceof Error ? error.message : 'Workflow execution stream failed',
        }),
    })
    if (!streamResult.ok) {
      throw new Error('Queued workflow execution was not found')
    }
    return new NextResponse(streamResult.stream, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        'X-Execution-Id': executionId,
      },
    })
  }

  const waitResult = await waitForApiWorkflowResult({
    executionId,
    workflowId: validation.workflow.id,
  })
  if (waitResult.status === 'completed') {
    return createApiWorkflowResponse(waitResult.result)
  }

  return createQueuedApiWorkflowResponse({
    executionId,
    workflowName: validation.workflow.name,
    createdAt,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: workflowId } = await params

  try {
    let body: Record<string, unknown> = {}
    const bodyText = await request.text()
    try {
      body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {}
    } catch {
      return createErrorResponse('Invalid JSON in request body', 400)
    }

    const unsupportedField = findUnsupportedApiExecuteField(body)
    if (unsupportedField) {
      return createErrorResponse(
        `Field "${unsupportedField}" is not supported by the deployed API execute endpoint`,
        400
      )
    }
    const stream = body.stream === true
    if (body.stream !== undefined && typeof body.stream !== 'boolean') {
      return createErrorResponse('Field "stream" must be a boolean', 400)
    }
    const selectedOutputs = resolveSelectedOutputs(body.selectedOutputs)
    if (!selectedOutputs) {
      return createErrorResponse('Field "selectedOutputs" must be an array of strings', 400)
    }
    const input = resolveWorkflowInput(body)
    if (input instanceof Response) return input

    return await executeApiWorkflowThroughQueue({
      request,
      workflowId,
      input,
      requestId,
      stream,
      selectedOutputs,
    })
  } catch (error) {
    if (isPendingExecutionLimitError(error)) {
      return createErrorResponse('Pending execution backlog is full', error.statusCode)
    }

    if (error instanceof TriggerExecutionUnavailableError) {
      return createErrorResponse(error.message, error.statusCode)
    }

    if (error instanceof RateLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'RATE_LIMIT_EXCEEDED')
    }

    if (error instanceof ExecutionGateError) {
      return createErrorResponse(error.message, error.statusCode, 'USAGE_LIMIT_EXCEEDED')
    }

    logger.error(`[${requestId}] Failed to execute workflow`, {
      workflowId,
      error,
    })

    return createErrorResponse('Failed to execute workflow', 500)
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-API-Key, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version',
      'Access-Control-Max-Age': '86400',
    },
  })
}
