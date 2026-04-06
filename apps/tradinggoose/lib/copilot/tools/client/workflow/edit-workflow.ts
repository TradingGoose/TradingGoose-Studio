import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { shouldAutoApplyWorkflowEdits } from '@/lib/copilot/access-policy'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import {
  requireActiveWorkflowSession,
  resolveWorkflowIdFromExecutionContext,
  serializeReadableWorkflowSnapshot,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { setWorkflowState } from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store'

interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

interface EditWorkflowArgs {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

export class EditWorkflowClientTool extends BaseClientTool {
  static readonly id = 'edit_workflow'
  private lastResult: any | undefined
  private hasExecuted = false
  private hasAppliedState = false
  private lastWorkflowId: string | null = null

  private resolvePersistedStagedResult(): any | undefined {
    return this.resolvePersistedResult()
  }

  constructor(toolCallId: string) {
    super(toolCallId, EditWorkflowClientTool.id, EditWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing your workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Editing your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited your workflow', icon: Grid2x2Check },
      [ClientToolCallState.error]: { text: 'Failed to edit your workflow', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow changes', icon: Grid2x2 },
      [ClientToolCallState.rejected]: { text: 'Rejected workflow changes', icon: Grid2x2X },
      [ClientToolCallState.aborted]: { text: 'Aborted editing your workflow', icon: MinusCircle },
      [ClientToolCallState.pending]: { text: 'Editing your workflow', icon: Loader2 },
    },
    interrupt: {
      accept: { text: 'Accept changes', icon: Grid2x2Check },
      reject: { text: 'Reject changes', icon: Grid2x2X },
    },
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return this.getState() === ClientToolCallState.review ? this.metadata.interrupt : undefined
  }

  async handleAccept(): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    try {
      logger.info('handleAccept called', {
        toolCallId: this.toolCallId,
        state: this.getState(),
        hasResult: this.lastResult !== undefined,
      })
      const stagedResult = this.lastResult ?? this.resolvePersistedStagedResult()
      if (stagedResult && !this.lastResult) {
        this.lastResult = stagedResult
      }

      if (!stagedResult?.workflowState) {
        throw new Error('No staged workflow edits found to accept')
      }

      const executionContext = this.requireExecutionContext()
      const session = requireActiveWorkflowSession(
        executionContext,
        this.lastWorkflowId ?? executionContext.workflowId
      )

      if (!this.hasAppliedState) {
        setWorkflowState(session.doc, stagedResult.workflowState, YJS_ORIGINS.COPILOT_REVIEW_ACCEPT)
        this.hasAppliedState = true
      }

      this.setState(ClientToolCallState.success)
      const completed = await this.markToolComplete(200, 'Workflow edits accepted', stagedResult)
      if (!completed) {
        logger.warn('markToolComplete failed during handleAccept', {
          toolCallId: this.toolCallId,
        })
      }
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('handleAccept failed', { toolCallId: this.toolCallId, message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, message || 'Failed to apply workflow edits')
    }
  }

  protected getRejectCompletionMessage(): string {
    return 'Workflow changes rejected'
  }

  protected async getPendingUserAction(): Promise<'execute'> {
    return 'execute'
  }

  protected async prepareReviewAccept(args?: EditWorkflowArgs): Promise<boolean> {
    const stagedResult = this.lastResult ?? this.resolvePersistedStagedResult()

    if (!stagedResult?.workflowState) {
      await this.execute(args)
      return this.resolveUserActionState() === ClientToolCallState.review
    }

    return true
  }

  async execute(args?: EditWorkflowArgs): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    try {
      if (this.hasExecuted) {
        logger.info('execute skipped (already executed)', { toolCallId: this.toolCallId })
        return
      }
      this.hasExecuted = true
      logger.info('execute called', { toolCallId: this.toolCallId, argsProvided: !!args })
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()

      // Resolve workflowId
      const workflowId = resolveWorkflowIdFromExecutionContext(executionContext, args?.workflowId)
      this.lastWorkflowId = workflowId

      // Validate operations
      const operations = args?.operations || []
      if (!operations.length) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No operations provided for edit_workflow')
        return
      }

      // Build the edit baseline from the live Yjs workflow doc when available,
      // but allow review-mode staging to fall back to the persisted workflow.
      let currentUserWorkflow = args?.currentUserWorkflow

      if (!currentUserWorkflow) {
        try {
          currentUserWorkflow = (
            await serializeReadableWorkflowSnapshot(
              executionContext,
              workflowId
            )
          ).currentUserWorkflow
        } catch (e) {
          logger.warn('Failed to build currentUserWorkflow from readable workflow snapshot', e as any)
          throw new Error('Failed to read the current workflow')
        }
      }

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'edit_workflow',
          payload: {
            operations,
            workflowId,
            ...(currentUserWorkflow ? { currentUserWorkflow } : {}),
          },
        }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        try {
          const errorJson = JSON.parse(errorText)
          throw new Error(errorJson.error || errorText || `Server error (${res.status})`)
        } catch {
          throw new Error(errorText || `Server error (${res.status})`)
        }
      }

      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = parsed.result as any
      if (!result.workflowState) {
        throw new Error('No workflow state returned from server')
      }

      this.lastResult = result
      this.hasAppliedState = false
      logger.info('server result parsed', {
        hasWorkflowState: !!result?.workflowState,
        blocksCount: result?.workflowState
          ? Object.keys(result.workflowState.blocks || {}).length
          : 0,
      })

      const accessLevel = getCopilotStoreForToolCall(this.toolCallId).getState().accessLevel
      if (shouldAutoApplyWorkflowEdits(accessLevel)) {
        logger.info('Auto-applying workflow edits for full access session', {
          toolCallId: this.toolCallId,
        })
        await this.handleAccept()
        return
      }

      // Move into review state and wait for user approval/rejection to mark complete
      this.setState(ClientToolCallState.review, { result })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
