import { Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import type { z } from 'zod'
import type { ToolArgSchemas } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { executeWorkflowWithFullLogging } from '@/lib/copilot/tools/client/workflow/workflow-execution-utils'
import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import { createLogger } from '@/lib/logs/console/logger'
import { WorkflowQueueAdmissionError } from '@/lib/workflows/queued-execution-client'
import { useExecutionStore } from '@/stores/execution/store'

type RunWorkflowArgs = z.infer<typeof ToolArgSchemas.run_workflow>

export class RunWorkflowClientTool extends BaseClientTool {
  // Only a proven refusal permits retry; a fresh instance cannot attest an older attempt.
  private executionAttempted?: boolean

  constructor(toolCallId: string) {
    super(toolCallId, RunWorkflowClientTool.metadata)
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

  async execute(args?: RunWorkflowArgs): Promise<void> {
    const logger = createLogger('RunWorkflowClientTool')
    const params: Partial<RunWorkflowArgs> = args ?? {}

    // prevent concurrent execution
    const { isExecuting, setIsExecuting } = useExecutionStore.getState()
    if (isExecuting) {
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
      this.fail('entityId is required')
      return
    }

    if (typeof params.triggerBlockId !== 'string' || params.triggerBlockId.length === 0) {
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

    setIsExecuting(true)
    try {
      this.setState(ClientToolCallState.executing)

      const native = await this.requireNativeTarget()
      // Keep replay blocked unless admission explicitly confirms that nothing was queued.
      this.executionAttempted = true
      const result = await executeWorkflowWithFullLogging({
        native,
        signal: this.getAbortSignal(),
        workflowInput,
        workflowId: activeWorkflowId,
        triggerBlockId: params.triggerBlockId,
      })

      // Completion is attested from the actual canonical retained execution, including a real failed outcome.
      await this.completeAuthoritativeReadback()
      this.setState(result.success ? ClientToolCallState.success : ClientToolCallState.error, {
        result,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logger.error('Run workflow failed', { message })

      this.fail(message)
      if (error instanceof WorkflowQueueAdmissionError) {
        this.executionAttempted = false
        this.setState(ClientToolCallState.pending)
      }
    } finally {
      setIsExecuting(false)
    }
  }
}
