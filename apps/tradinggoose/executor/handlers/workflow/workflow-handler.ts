import { generateInternalToken, type InternalWorkflowExecutionContext } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import type { TraceSpan } from '@/lib/logs/types'
import { getBaseUrl } from '@/lib/urls/utils'
import { isWorkflowBlockType } from '@/executor/consts'
import {
  type BlockHandler,
  type DeferredBlockExecution,
  type ExecutionContext,
  type ExecutionResult,
  type NormalizedBlockOutput,
  PausedBlockExecution,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WorkflowBlockHandler')

const MAX_WORKFLOW_DEPTH = 10
const CHILD_WORKFLOW_POLL_INTERVAL_MS = 1_000
const CHILD_WORKFLOW_WAIT_TIMEOUT_MS = 30 * 60 * 1000

type QueuedWorkflowExecutionResult = Pick<
  ExecutionResult,
  'success' | 'status' | 'output' | 'error'
> & {
  traceSpans?: TraceSpan[]
}

type QueueWorkflowResponse = {
  taskId: string
  workflowName: string
}

type JobStatusResponse =
  | { status: 'queued' | 'processing' }
  | { status: 'paused' | 'completed' | 'failed'; output: QueuedWorkflowExecutionResult }

type ChildWorkflowHeaders = () => Promise<Record<string, string>>

type ChildWorkflowWaitOptions = {
  taskId: string
  headers: ChildWorkflowHeaders
  shouldCancelExecution?: () => Promise<boolean>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const readResponseErrorMessage = async (response: Response, defaultMessage: string) => {
  try {
    const body = await response.json()
    if (typeof body?.error === 'string') return body.error
  } catch {}
  return defaultMessage
}

export class WorkflowBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return isWorkflowBlockType(block.metadata?.id)
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput | DeferredBlockExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    const workflowId = inputs.workflowId
    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    const currentDepth = context.workflowDepth ?? 0
    if (currentDepth >= MAX_WORKFLOW_DEPTH) {
      throw new Error(`Maximum workflow nesting depth of ${MAX_WORKFLOW_DEPTH} exceeded`)
    }

    const childWorkflowInput = this.resolveChildWorkflowInput(inputs)
    const pausePointId = context.currentVirtualBlockId ?? block.id
    if (context.resumeInputs?.has(pausePointId)) {
      const childResult = context.resumeInputs.get(
        pausePointId
      ) as QueuedWorkflowExecutionResult & {
        childWorkflowName: string
      }
      context.resumeInputs.delete(pausePointId)
      return this.mapChildOutputToParent(childResult, childResult.childWorkflowName)
    }

    return {
      kind: 'deferred',
      wait: async () => {
        try {
          const workflowExecution: InternalWorkflowExecutionContext = {
            source: 'workflow_block',
            parentWorkflowId: context.workflowId,
            parentExecutionId: context.executionId,
            parentPendingExecutionId: context.pendingExecutionId,
            parentBlockId: block.id,
          }
          const headers = async () => ({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await generateInternalToken(context.userId, { workflowExecution })}`,
          })
          const queueResponse = await this.queueChildWorkflowExecution({
            headers,
            workflowId,
            input: childWorkflowInput,
            executionTarget: context.isDeployedContext ? 'deployed' : 'live',
            workflowDepth: currentDepth + 1,
          })

          const childWorkflowName = queueResponse.workflowName
          const childResult = await this.waitForQueuedWorkflowResult({
            taskId: queueResponse.taskId,
            headers,
            shouldCancelExecution: context.shouldCancelExecution,
          })
          if (childResult.status === 'paused') {
            return new PausedBlockExecution({
              id: pausePointId,
              blockId: block.id,
              blockName: block.metadata?.name ?? 'Workflow',
              kind: 'child',
              childExecutionId: queueResponse.taskId,
              childWorkflowId: workflowId,
              childWorkflowName,
              displayData: childResult.output,
              inputFormat: [],
            })
          }
          return this.mapChildOutputToParent(childResult, childWorkflowName)
        } catch (error: any) {
          logger.error(`Error executing child workflow ${workflowId}:`, error)

          if (error?.childWorkflowName) throw error
          throw new Error(
            `Error executing child workflow ${workflowId}: ${error?.message || 'Unknown error'}`
          )
        }
      },
    }
  }

  private resolveChildWorkflowInput(inputs: Record<string, any>): Record<string, any> {
    if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
      try {
        const normalized =
          typeof inputs.inputMapping === 'string'
            ? JSON.parse(inputs.inputMapping)
            : inputs.inputMapping
        if (normalized && typeof normalized === 'object' && !Array.isArray(normalized))
          return normalized
      } catch {}
      return {}
    }

    if (inputs.input !== undefined) {
      return inputs.input
    }

    return {}
  }

  private async queueChildWorkflowExecution(params: {
    headers: ChildWorkflowHeaders
    workflowId: string
    input: Record<string, any>
    executionTarget: 'deployed' | 'live'
    workflowDepth: number
  }): Promise<QueueWorkflowResponse> {
    const response = await fetch(`${getBaseUrl()}/api/workflows/${params.workflowId}/queue`, {
      method: 'POST',
      headers: await params.headers(),
      body: JSON.stringify({
        input: params.input,
        executionTarget: params.executionTarget,
        triggerType: 'api',
        workflowDepth: params.workflowDepth,
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(
        await readResponseErrorMessage(
          response,
          `Failed to queue child workflow: ${response.status} ${response.statusText}`
        )
      )
    }

    const body = (await response.json()) as QueueWorkflowResponse
    if (!body?.taskId) {
      throw new Error('Child workflow queue response is missing taskId')
    }
    if (!body?.workflowName) {
      throw new Error('Child workflow queue response is missing workflowName')
    }

    return body
  }

  private async cancelQueuedWorkflowExecution(
    taskId: string,
    headers: ChildWorkflowHeaders
  ): Promise<void> {
    const response = await fetch(`${getBaseUrl()}/api/jobs/${taskId}`, {
      method: 'DELETE',
      headers: await headers(),
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(
        await readResponseErrorMessage(
          response,
          `Failed to cancel child workflow: ${response.status} ${response.statusText}`
        )
      )
    }
  }

  private async waitForQueuedWorkflowResult({
    taskId,
    headers,
    shouldCancelExecution,
  }: ChildWorkflowWaitOptions): Promise<QueuedWorkflowExecutionResult> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < CHILD_WORKFLOW_WAIT_TIMEOUT_MS) {
      if (await shouldCancelExecution?.()) {
        await this.cancelQueuedWorkflowExecution(taskId, headers)
        throw new Error('Child workflow execution was cancelled')
      }

      const response = await fetch(`${getBaseUrl()}/api/jobs/${taskId}`, {
        headers: await headers(),
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(
          await readResponseErrorMessage(
            response,
            `Failed to fetch child workflow status: ${response.status} ${response.statusText}`
          )
        )
      }

      const body = (await response.json()) as JobStatusResponse

      if (body.status === 'paused' || body.status === 'completed' || body.status === 'failed')
        return body.output

      await sleep(CHILD_WORKFLOW_POLL_INTERVAL_MS)
    }

    await this.cancelQueuedWorkflowExecution(taskId, headers)
    throw new Error('Child workflow execution timed out')
  }

  private mapChildOutputToParent(
    childResult: QueuedWorkflowExecutionResult,
    childWorkflowName: string
  ): NormalizedBlockOutput {
    const childTraceSpans = childResult.traceSpans ?? []
    if (!childResult.success) {
      throw Object.assign(
        new Error(
          `Error in child workflow "${childWorkflowName}": ${childResult.error ?? 'Child workflow execution failed'}`
        ),
        { childWorkflowName, childTraceSpans }
      )
    }
    return {
      success: true,
      childWorkflowName,
      result: childResult.output,
      childTraceSpans,
    }
  }
}
