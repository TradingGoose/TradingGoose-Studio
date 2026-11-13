import { Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
  WORKFLOW_EXECUTION_TIMEOUT_MS,
} from '@/lib/copilot/tools/client/base-tool'
import { executeWorkflowWithFullLogging } from '@/lib/copilot/tools/client/workflow/workflow-execution-utils'
import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import { createLogger } from '@/lib/logs/console/logger'
import { useExecutionStore } from '@/stores/execution/store'

interface RunWorkflowArgs {
  entityId: string
  description?: string
  triggerBlockId: string
  workflow_input?: Record<string, any> | string
}

export class RunWorkflowClientTool extends BaseClientTool {
  static readonly id = 'run_workflow'
  // Only a local refusal proves false; a fresh instance cannot attest an older attempt.
  private executionAttempted?: boolean

  constructor(toolCallId: string) {
    super(toolCallId, RunWorkflowClientTool.id, RunWorkflowClientTool.metadata)
  }

  hasAttemptedExecution() {
    return this.executionAttempted
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
    },
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async handleAccept(args?: RunWorkflowArgs): Promise<void> {
    const logger = createLogger('RunWorkflowClientTool')
    await this.executeWithTimeout(async () => {
      const params = (args ?? {}) as Partial<RunWorkflowArgs>
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
        this.fail('The workflow is already in the middle of an execution. Try again later')
        if (this.executionAttempted !== true) {
          this.executionAttempted = false
          this.setState(ClientToolCallState.pending)
        }
        return
      }

      let activeWorkflowId: string
      try {
        activeWorkflowId = requireCopilotEntityId(params)
      } catch {
        logger.debug('Execution prevented: no target workflow')
        this.setState(ClientToolCallState.error)
        this.fail('entityId is required')
        return
      }
      logger.debug('Using target workflow', { workflowId: activeWorkflowId })

      if (typeof params.triggerBlockId !== 'string' || params.triggerBlockId.length === 0) {
        logger.debug('Execution prevented: no trigger block selected')
        this.setState(ClientToolCallState.error)
        this.fail('triggerBlockId is required')
        return
      }

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

        const native = await this.requireNativeTarget()
        // Once the execution path is entered, a later failure cannot prove that nothing ran.
        this.executionAttempted = true
        const result = await executeWorkflowWithFullLogging({
          native,
          signal: this.getAbortSignal(),
          workflowInput,
          executionId: this.toolCallId,
          workflowId: activeWorkflowId,
          triggerBlockId: params.triggerBlockId,
        })

        // Completion is attested from the actual canonical retained execution, including a real failed outcome.
        await this.completeAuthoritativeReadback()
        this.setState(result.success ? ClientToolCallState.success : ClientToolCallState.error, {
          result,
        })
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error)

        logger.error('Run workflow failed', { message })

        this.setState(ClientToolCallState.error)
        this.fail(message)
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
