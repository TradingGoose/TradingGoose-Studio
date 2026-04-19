import { generateInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import type { TraceSpan } from '@/lib/logs/types'
import { getBaseUrl } from '@/lib/urls/utils'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type {
  BlockHandler,
  DeferredBlockExecution,
  ExecutionContext,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowBlockHandler')

const MAX_WORKFLOW_DEPTH = 10
const CHILD_WORKFLOW_POLL_INTERVAL_MS = 1_000

type WorkflowTraceSpan = TraceSpan & {
  metadata?: Record<string, unknown>
  children?: WorkflowTraceSpan[]
}

type QueuedWorkflowExecutionResult = {
  success?: boolean
  output?: Record<string, unknown>
  error?: string
  traceSpans?: TraceSpan[]
}

type QueueWorkflowResponse = {
  taskId: string
  workflowName?: string
}

type JobStatusResponse = {
  status?: 'queued' | 'processing' | 'completed' | 'failed'
  output?: QueuedWorkflowExecutionResult
  error?: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class WorkflowBlockHandler implements BlockHandler {
  private safeParse(input: unknown): unknown {
    if (typeof input !== 'string') return input
    try {
      return JSON.parse(input)
    } catch {
      return input
    }
  }

  canHandle(block: SerializedBlock): boolean {
    const id = block.metadata?.id
    return id === BlockType.WORKFLOW || id === 'workflow_input'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput | DeferredBlockExecution> {
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
    const fallbackChildWorkflowName = this.resolveChildWorkflowName(workflowId)

    return {
      kind: 'deferred',
      wait: async () => {
        try {
          const headers = await this.buildHeaders(context)
          const queueResponse = await this.queueChildWorkflowExecution({
            headers,
            workflowId,
            input: childWorkflowInput,
            executionTarget: context.isDeployedContext ? 'deployed' : 'live',
            triggerType: context.triggerType ?? 'manual',
            workflowDepth: currentDepth + 1,
            parentWorkflowId: context.workflowId,
            parentExecutionId: context.executionId,
            parentBlockId: block.id,
          })

          const childWorkflowName = queueResponse.workflowName || fallbackChildWorkflowName
          const childResult = await this.waitForQueuedWorkflowResult(queueResponse.taskId, headers)
          const childTraceSpans = this.transformChildWorkflowSpans(
            childResult.traceSpans,
            childWorkflowName
          )

          const mappedResult = this.mapChildOutputToParent(
            childResult,
            childWorkflowName,
            childTraceSpans
          )

          if ((mappedResult as { success?: boolean }).success === false) {
            const childError =
              (mappedResult as { error?: string }).error || 'Child workflow execution failed'
            const errorWithSpans = new Error(
              `Error in child workflow "${childWorkflowName}": ${childError}`
            ) as Error & {
              childTraceSpans?: WorkflowTraceSpan[]
              childWorkflowName?: string
            }
            errorWithSpans.childTraceSpans = childTraceSpans
            errorWithSpans.childWorkflowName = childWorkflowName
            throw errorWithSpans
          }

          return mappedResult
        } catch (error: any) {
          logger.error(`Error executing child workflow ${workflowId}:`, error)

          const childWorkflowName =
            error?.childWorkflowName || this.resolveChildWorkflowName(workflowId)
          const originalError = error?.message || 'Unknown error'

          if (originalError.startsWith('Error in child workflow')) {
            throw error
          }

          const wrappedError = new Error(
            `Error in child workflow "${childWorkflowName}": ${originalError}`
          ) as Error & {
            childTraceSpans?: WorkflowTraceSpan[]
            childWorkflowName?: string
          }

          if (Array.isArray(error?.childTraceSpans)) {
            wrappedError.childTraceSpans = error.childTraceSpans
          }
          wrappedError.childWorkflowName = childWorkflowName

          throw wrappedError
        }
      },
    }
  }

  private resolveChildWorkflowInput(inputs: Record<string, any>): Record<string, any> {
    if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
      const normalized = this.safeParse(inputs.inputMapping)
      if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
        return normalized as Record<string, any>
      }
      return {}
    }

    if (inputs.input !== undefined) {
      return inputs.input
    }

    return {}
  }

  private resolveChildWorkflowName(workflowId: string): string {
    const workflowMetadata = useWorkflowRegistry.getState().workflows[workflowId]
    return workflowMetadata?.name || workflowId
  }

  private async buildHeaders(
    context: Pick<ExecutionContext, 'userId'>,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (typeof window === 'undefined') {
      const token = await generateInternalToken(context.userId)
      headers.Authorization = `Bearer ${token}`
    }

    return headers
  }

  private async queueChildWorkflowExecution(params: {
    headers: Record<string, string>
    workflowId: string
    input: Record<string, any>
    executionTarget: 'deployed' | 'live'
    triggerType: string
    workflowDepth: number
    parentWorkflowId?: string
    parentExecutionId?: string
    parentBlockId: string
  }): Promise<QueueWorkflowResponse> {
    const response = await fetch(`${getBaseUrl()}/api/workflows/${params.workflowId}/queue`, {
      method: 'POST',
      headers: params.headers,
      body: JSON.stringify({
        input: params.input,
        executionTarget: params.executionTarget,
        triggerType: params.triggerType,
        workflowDepth: params.workflowDepth,
        parentWorkflowId: params.parentWorkflowId,
        parentExecutionId: params.parentExecutionId,
        parentBlockId: params.parentBlockId,
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      let message = `Failed to queue child workflow: ${response.status} ${response.statusText}`
      try {
        const body = await response.json()
        if (typeof body?.error === 'string') {
          message = body.error
        } else if (typeof body?.message === 'string') {
          message = body.message
        }
      } catch {}

      throw new Error(message)
    }

    const body = (await response.json()) as QueueWorkflowResponse
    if (!body?.taskId) {
      throw new Error('Child workflow queue response is missing taskId')
    }

    return body
  }

  private async waitForQueuedWorkflowResult(
    taskId: string,
    headers: Record<string, string>
  ): Promise<QueuedWorkflowExecutionResult> {
    while (true) {
      const response = await fetch(`${getBaseUrl()}/api/jobs/${taskId}`, {
        headers,
        cache: 'no-store',
      })

      if (!response.ok) {
        let message = `Failed to fetch child workflow status: ${response.status} ${response.statusText}`
        try {
          const body = await response.json()
          if (typeof body?.error === 'string') {
            message = body.error
          } else if (typeof body?.message === 'string') {
            message = body.message
          }
        } catch {}

        throw new Error(message)
      }

      const body = (await response.json()) as JobStatusResponse

      if (body.status === 'completed') {
        return body.output ?? {}
      }

      if (body.status === 'failed') {
        throw new Error(body.error || 'Child workflow execution failed')
      }

      await sleep(CHILD_WORKFLOW_POLL_INTERVAL_MS)
    }
  }

  private transformChildWorkflowSpans(
    spans: TraceSpan[] | undefined,
    childWorkflowName: string
  ): WorkflowTraceSpan[] {
    if (!Array.isArray(spans) || spans.length === 0) {
      return []
    }

    return this.processChildWorkflowSpans(spans).map((span) =>
      this.transformSpanForChildWorkflow(span, childWorkflowName)
    )
  }

  private transformSpanForChildWorkflow(
    span: WorkflowTraceSpan,
    childWorkflowName: string
  ): WorkflowTraceSpan {
    const metadata: Record<string, unknown> = {
      ...(span.metadata ?? {}),
      isFromChildWorkflow: true,
      childWorkflowName,
    }

    const transformedChildren = Array.isArray(span.children)
      ? span.children.map((childSpan) =>
          this.transformSpanForChildWorkflow(childSpan, childWorkflowName)
        )
      : undefined

    return {
      ...span,
      metadata,
      ...(transformedChildren ? { children: transformedChildren } : {}),
    }
  }

  private processChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const processed: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (Array.isArray(span.children)) {
          processed.push(...this.processChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        workflowSpan.children = this.processChildWorkflowSpans(workflowSpan.children as TraceSpan[])
      }

      processed.push(workflowSpan)
    })

    return processed
  }

  private isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
    if (!span || span.type !== 'workflow') return false
    return !span.blockId
  }

  private mapChildOutputToParent(
    childResult: QueuedWorkflowExecutionResult,
    childWorkflowName: string,
    childTraceSpans: WorkflowTraceSpan[]
  ): BlockOutput {
    if (childResult.success === false) {
      const failure: Record<string, any> = {
        success: false,
        childWorkflowName,
        error: childResult.error || 'Child workflow execution failed',
      }
      if (childTraceSpans.length > 0) {
        failure.childTraceSpans = childTraceSpans
      }
      return failure
    }

    return {
      success: true,
      childWorkflowName,
      result: childResult.output || {},
      childTraceSpans,
    } as Record<string, any>
  }
}
