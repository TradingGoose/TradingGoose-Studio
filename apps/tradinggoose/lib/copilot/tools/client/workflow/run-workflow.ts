import { Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
  WORKFLOW_EXECUTION_TIMEOUT_MS,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { executeWorkflowWithFullLogging } from '@/lib/copilot/tools/client/workflow/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'

interface RunWorkflowArgs {
  workflowId: string
  description?: string
  workflow_input?: Record<string, any> | string
}

export class RunWorkflowClientTool extends BaseClientTool {
  static readonly id = 'run_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, RunWorkflowClientTool.id, RunWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to run your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Run this workflow?', icon: Play },
      [ClientToolCallState.executing]: { text: 'Running your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Workflow executed', icon: Play },
      [ClientToolCallState.error]: { text: 'Errored running workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Workflow execution skipped', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted workflow execution', icon: MinusCircle },
      [ClientToolCallState.background]: { text: 'Running in background', icon: Play },
    },
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: RunWorkflowArgs): Promise<void> {
    const logger = createLogger('RunWorkflowClientTool')
    await this.executeWithTimeout(async () => {
      const params = (args ?? {}) as Partial<RunWorkflowArgs>
      const executionContext = this.requireExecutionContext()
      logger.debug('handleAccept() called', {
        toolCallId: this.toolCallId,
        state: this.getState(),
        hasArgs: !!args,
        argKeys: args ? Object.keys(args) : [],
      })

      // prevent concurrent execution
      const { isExecuting, setIsExecuting } = useExecutionStore.getState()
      if (isExecuting) {
        logger.debug('Execution prevented: already executing')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(
          409,
          'The workflow is already in the middle of an execution. Try again later'
        )
        return
      }

      const activeWorkflowId = params.workflowId?.trim()
      if (!activeWorkflowId) {
        logger.debug('Execution prevented: no target workflow')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'workflowId is required')
        return
      }
      logger.debug('Using target workflow', { workflowId: activeWorkflowId })

      let workflowInput: Record<string, any> | undefined
      if (params.workflow_input !== undefined) {
        if (typeof params.workflow_input === 'string') {
          workflowInput = { input: params.workflow_input }
        } else if (params.workflow_input && typeof params.workflow_input === 'object') {
          workflowInput = params.workflow_input
        }
      }

      if (workflowInput?.input) {
        logger.debug('Workflow input provided', {
          inputPreview: String(workflowInput.input).slice(0, 120),
        })
      } else if (workflowInput) {
        logger.debug('Workflow input provided', {
          inputFields: Object.keys(workflowInput),
          inputPreview: JSON.stringify(workflowInput).slice(0, 120),
        })
      }

      let shouldClearExecution = false
      try {
        setIsExecuting(true)
        shouldClearExecution = true
        logger.debug('Set isExecuting(true) and switching state to executing')
        this.setState(ClientToolCallState.executing)

        const executionStartTime = new Date().toISOString()
        logger.debug('Starting workflow execution', {
          executionStartTime,
          executionId: this.toolCallId,
        })

        const result = await executeWorkflowWithFullLogging({
          workflowInput,
          executionId: this.toolCallId,
          channelId: executionContext.channelId,
          workflowId: activeWorkflowId,
        })

        // Determine success for both non-streaming and streaming executions
        let succeeded = true
        let errorMessage: string | undefined
        try {
          if (result && typeof result === 'object' && 'success' in (result as any)) {
            succeeded = Boolean((result as any).success)
            if (!succeeded) {
              errorMessage = (result as any)?.error || (result as any)?.output?.error
            }
          } else if (
            result &&
            typeof result === 'object' &&
            'execution' in (result as any) &&
            (result as any).execution &&
            typeof (result as any).execution === 'object'
          ) {
            succeeded = Boolean((result as any).execution.success)
            if (!succeeded) {
              errorMessage =
                (result as any).execution?.error || (result as any).execution?.output?.error
            }
          }
        } catch {}

        if (succeeded) {
          logger.debug('Workflow execution finished with success')
          this.setState(ClientToolCallState.success)
          await this.markToolComplete(
            200,
            `Workflow execution completed. Started at: ${executionStartTime}`
          )
        } else {
          const msg = errorMessage || 'Workflow execution failed'
          logger.error('Workflow execution finished with failure', { message: msg })
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(500, msg)
        }
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error)
        const failedDependency = typeof message === 'string' && /dependency/i.test(message)
        const status = failedDependency ? 424 : 500

        logger.error('Run workflow failed', { message })

        this.setState(ClientToolCallState.error)
        await this.markToolComplete(status, failedDependency ? undefined : message)
      } finally {
        if (shouldClearExecution) {
          setIsExecuting(false)
        }
      }
    }, WORKFLOW_EXECUTION_TIMEOUT_MS)
  }

  async execute(args?: RunWorkflowArgs): Promise<void> {
    // Route explicit execute() calls through the same accept path.
    await this.handleAccept(args)
  }
}
