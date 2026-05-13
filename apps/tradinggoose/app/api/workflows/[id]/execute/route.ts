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
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { openWorkflowExecutionEventStream } from '@/lib/execution/workflow-execution-stream'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { encodeSSE, generateRequestId, SSE_HEADERS } from '@/lib/utils'
import { createChatOutputEventReader } from '@/lib/workflows/chat-output'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import type { WorkflowExecutionEventEntry } from '@/lib/workflows/execution-events'
import { createPublicExecutionResult, isExecutionResult } from '@/lib/workflows/execution-result'
import { processWorkflowInputFormatFiles } from '@/lib/workflows/input-format-files'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import type { ExecutionResult } from '@/executor/types'
import { RateLimitError } from '@/services/queue'

const logger = createLogger('WorkflowExecuteAPI')
const API_EXECUTION_POLL_INTERVAL_MS = 1_000
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
}): Promise<ExecutionResult> {
  while (true) {
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

type PublicSelectedOutput = {
  blockName: string
  path: string
}

function readPublicSelectedOutputs(value: unknown): PublicSelectedOutput[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return null
  }
  const outputs = value.map((entry) => {
    const separatorIndex = entry.indexOf('.')
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) return null

    const blockName = entry.slice(0, separatorIndex).trim()
    const path = entry.slice(separatorIndex + 1).trim()
    return blockName && path ? { blockName, path } : null
  })
  return outputs.every(Boolean) ? (outputs as PublicSelectedOutput[]) : null
}

function normalizePublicBlockName(value: unknown) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
    : ''
}

function resolveSelectedOutputs(
  value: unknown,
  blocks: Record<string, any>
): { ok: true; selectedOutputs: string[] } | { ok: false; error: string } {
  const requestedOutputs = readPublicSelectedOutputs(value)
  if (!requestedOutputs) {
    return {
      ok: false,
      error: 'Field "selectedOutputs" must use blockName.path strings',
    }
  }

  const blockNames = new Map<string, string>()
  const duplicateNames = new Set<string>()
  for (const [blockId, block] of Object.entries(blocks)) {
    const key = normalizePublicBlockName(block?.name)
    if (!key) continue
    if (blockNames.has(key)) {
      duplicateNames.add(key)
      continue
    }
    blockNames.set(key, blockId)
  }

  const selectedOutputs: string[] = []
  for (const { blockName, path } of requestedOutputs) {
    const key = normalizePublicBlockName(blockName)
    if (duplicateNames.has(key)) {
      return { ok: false, error: `Selected output block "${blockName}" is ambiguous` }
    }
    const blockId = blockNames.get(key)
    if (!blockId) {
      return { ok: false, error: `Selected output block "${blockName}" was not found` }
    }
    selectedOutputs.push(`${blockId}_${path}`)
  }

  return { ok: true, selectedOutputs }
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
      return encodeSSE({ event: 'final', data: createPublicExecutionResult(event.result) })
    })
}

async function executeApiWorkflowThroughQueue(params: {
  request: NextRequest
  workflowId: string
  input: Record<string, unknown>
  requestId: string
  stream: boolean
  selectedOutputs: unknown
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

  const workflowData = await loadDeployedWorkflowState(validation.workflow.id)
  if (!workflowData) {
    return createErrorResponse('Workflow has no deployed state', 400)
  }

  const selectedOutputs = resolveSelectedOutputs(params.selectedOutputs, workflowData.blocks ?? {})
  if (!selectedOutputs.ok) {
    return createErrorResponse(selectedOutputs.error, 400)
  }

  let input: Record<string, unknown>
  try {
    input = await processWorkflowInputFormatFiles({
      input: params.input,
      blocks: workflowData.blocks ?? {},
      blockType: 'api_trigger',
      executionContext: {
        workspaceId: validation.workflow.workspaceId,
        workflowId: validation.workflow.id,
        executionId,
      },
      requestId: params.requestId,
    })
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to process workflow input files',
      400
    )
  }

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
      stream: params.stream,
      selectedOutputs: selectedOutputs.selectedOutputs,
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
      formatEvent: createApiWorkflowStreamFormatter(selectedOutputs.selectedOutputs),
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
  return createApiWorkflowResponse(waitResult)
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
    const input = resolveWorkflowInput(body)
    if (input instanceof Response) return input

    return await executeApiWorkflowThroughQueue({
      request,
      workflowId,
      input,
      requestId,
      stream,
      selectedOutputs: body.selectedOutputs,
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
