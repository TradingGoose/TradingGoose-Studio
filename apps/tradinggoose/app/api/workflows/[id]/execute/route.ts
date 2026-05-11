import { type NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { authenticateApiKeyFromHeader } from '@/lib/api-key/service'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { generateRequestId } from '@/lib/utils'
import {
  createHttpResponseFromBlock,
  workflowHasResponseBlock,
} from '@/lib/workflows/utils'
import {
  createPublicExecutionResult,
  isExecutionResult,
} from '@/lib/workflows/execution-result'
import type { ExecutionResult } from '@/executor/types'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowExecuteAPI')
const API_EXECUTION_POLL_INTERVAL_MS = 500
const API_EXECUTION_WAIT_TIMEOUT_MS = 55 * 60 * 1000
const UNSUPPORTED_API_EXECUTE_FIELDS = [
  'stream',
  'selectedOutputs',
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
}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < API_EXECUTION_WAIT_TIMEOUT_MS) {
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
      return state.result
    }

    if (state.status === 'failed') {
      throw new Error(state.errorMessage || 'Workflow execution failed')
    }

    await sleep(API_EXECUTION_POLL_INTERVAL_MS)
  }

  throw new Error('Workflow execution timed out')
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

function resolveWorkflowInput(body: Record<string, unknown>) {
  if (body.input !== undefined) {
    return body.input
  }

  return body
}

async function executeApiWorkflowThroughQueue(params: {
  request: NextRequest
  workflowId: string
  input?: unknown
  requestId: string
}) {
  const validation = await validateWorkflowAccess(params.request, params.workflowId)
  if (validation.error || !validation.workflow) {
    return createErrorResponse(
      validation.error?.message ?? 'Workflow not found',
      validation.error?.status ?? 404
    )
  }

  const apiKeyHeader = params.request.headers.get('X-API-Key')
  if (!apiKeyHeader) {
    return createErrorResponse('Unauthorized', 401)
  }

  const apiKeyAuth = await authenticateApiKeyFromHeader(apiKeyHeader)
  if (!apiKeyAuth.success || !apiKeyAuth.userId) {
    return createErrorResponse('Unauthorized', 401)
  }

  const executionId = `workflow_execution_${randomUUID()}`
  await enqueuePendingExecution({
    executionType: 'workflow',
    pendingExecutionId: executionId,
    workflowId: validation.workflow.id,
    workspaceId: validation.workflow.workspaceId,
    userId: apiKeyAuth.userId,
    source: 'workflow_execute_api',
    requestId: params.requestId,
    payload: {
      executionId,
      workflowId: validation.workflow.id,
      userId: apiKeyAuth.userId,
      workspaceId: validation.workflow.workspaceId,
      input: params.input ?? {},
      triggerType: 'api',
      executionTarget: 'deployed',
      metadata: {
        source: 'workflow_execute_api',
        apiKeyId: apiKeyAuth.keyId ?? null,
      },
    },
  })

  const result = await waitForApiWorkflowResult({
    executionId,
    workflowId: validation.workflow.id,
  })
  return createApiWorkflowResponse(result)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    return await executeApiWorkflowThroughQueue({
      request,
      workflowId,
      input: resolveWorkflowInput(body),
      requestId,
    })
  } catch (error) {
    if (isPendingExecutionLimitError(error)) {
      return createErrorResponse('Pending execution backlog is full', error.statusCode)
    }

    if (error instanceof TriggerExecutionUnavailableError) {
      return createErrorResponse(error.message, error.statusCode)
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
