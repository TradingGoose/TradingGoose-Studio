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
  getReadableWorkflowSnapshot,
  requireActiveWorkflowSession,
  resolveWorkflowIdFromExecutionContext,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { extractPersistedStateFromDoc, setWorkflowState } from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store'

interface EditWorkflowArgs {
  workflowDocument: string
  documentFormat?: string
  workflowId?: string
}

export class EditWorkflowClientTool extends BaseClientTool {
  static readonly id = 'edit_workflow'
  private lastResult: any | undefined
  private hasExecuted = false
  private hasAppliedState = false
  private hasPersistedAcceptedState = false
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
      const workflowId = this.lastWorkflowId ?? executionContext.workflowId
      if (!workflowId) {
        throw new Error('No active workflow found')
      }
      const session = requireActiveWorkflowSession(
        executionContext,
        workflowId
      )

      if (!this.hasAppliedState) {
        setWorkflowState(session.doc, stagedResult.workflowState, YJS_ORIGINS.COPILOT_REVIEW_ACCEPT)
        this.hasAppliedState = true
      }
      if (!this.hasPersistedAcceptedState) {
        await this.persistAcceptedWorkflowState(workflowId, session.doc)
        this.hasPersistedAcceptedState = true
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

  private async persistAcceptedWorkflowState(workflowId: string, doc: Parameters<typeof setWorkflowState>[0]) {
    // Accept applies the reviewed state to the live Yjs doc immediately, but
    // the canonical workflow save route still owns DB persistence and follow-up
    // side effects such as custom-tool extraction.
    const persistedState = extractPersistedStateFromDoc(doc)
    const response = await fetch(`/api/workflows/${workflowId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(persistedState),
    })

    if (response.ok) {
      return
    }

    let errorMessage = `Failed to persist accepted workflow edits (${response.status})`

    try {
      const errorData = await response.json()
      if (errorData?.error) {
        errorMessage = String(errorData.error)
      }
    } catch {}

    throw new Error(errorMessage)
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

      const workflowDocument = args?.workflowDocument?.trim()
      if (!workflowDocument) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No workflowDocument provided for edit_workflow')
        return
      }

      let currentWorkflowState: string | undefined

      try {
        currentWorkflowState = JSON.stringify(
          (await getReadableWorkflowSnapshot(executionContext, workflowId)).workflowState
        )
      } catch (e) {
        logger.warn('Failed to build currentWorkflowState from readable workflow snapshot', e as any)
        throw new Error('Failed to read the current workflow')
      }

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'edit_workflow',
          payload: {
            workflowId,
            workflowDocument,
            ...(args?.documentFormat ? { documentFormat: args.documentFormat } : {}),
            ...(currentWorkflowState ? { currentWorkflowState } : {}),
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
      this.hasPersistedAcceptedState = false
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
