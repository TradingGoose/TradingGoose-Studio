import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { shouldAutoApplyWorkflowEdits } from '@/lib/copilot/access-policy'
import { createLogger } from '@/lib/logs/console/logger'
import {
  buildWorkflowDocumentToolResult,
  getReadableWorkflowState,
  resolveWorkflowTarget,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { setWorkflowState } from '@/lib/yjs/workflow-session'
import { getRegisteredWorkflowSession } from '@/lib/yjs/workflow-session-registry'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'

interface EditWorkflowArgs {
  workflowDocument: string
  documentFormat?: string
  workflowId?: string
}

function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
}

export class EditWorkflowClientTool extends BaseClientTool {
  static readonly id: string = 'edit_workflow'
  private lastResult: any | undefined
  private hasExecuted = false
  private hasAppliedState = false
  private lastWorkflowId: string | null = null

  private resolvePersistedStagedResult(): any | undefined {
    return this.resolvePersistedResult()
  }

  constructor(
    toolCallId: string,
    toolName = EditWorkflowClientTool.id,
    metadata: BaseClientToolMetadata = EditWorkflowClientTool.metadata
  ) {
    super(toolCallId, toolName, metadata)
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

  async handleAccept(args?: EditWorkflowArgs): Promise<void> {
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
      const resolvedArgs = args || readStoredToolArgs<EditWorkflowArgs>(this.toolCallId)
      const requestedWorkflowId =
        resolvedArgs?.workflowId?.trim() ??
        (typeof stagedResult?.workflowId === 'string' ? stagedResult.workflowId.trim() : undefined) ??
        this.lastWorkflowId ??
        undefined
      if (!requestedWorkflowId) {
        throw new Error('workflowId is required for edit_workflow')
      }
      const { workflowId } = await resolveWorkflowTarget(executionContext, {
        workflowId: requestedWorkflowId,
      })
      this.lastWorkflowId = workflowId
      const session = getRegisteredWorkflowSession(workflowId)

      if (session && !this.hasAppliedState) {
        setWorkflowState(session.doc, stagedResult.workflowState, YJS_ORIGINS.COPILOT_REVIEW_ACCEPT)
        this.hasAppliedState = true
      }
      if (!session) {
        await this.applyAcceptedWorkflowState(workflowId, stagedResult.workflowState)
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

  private async applyAcceptedWorkflowState(workflowId: string, workflowState: Record<string, any>) {
    const response = await fetch(`/api/workflows/${workflowId}/apply-live-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowState,
      }),
    })

    if (response.ok) {
      return
    }

    let errorMessage = `Failed to apply accepted workflow edits (${response.status})`

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

  protected getServerToolName(): string {
    return EditWorkflowClientTool.id
  }

  protected buildServerPayload(
    workflowId: string,
    args: Record<string, any> | undefined,
    currentWorkflowState: string | undefined
  ): Record<string, any> {
    const workflowDocument = args?.workflowDocument?.trim()
    if (!workflowDocument) {
      throw new Error(`No workflowDocument provided for ${this.getServerToolName()}`)
    }

    return {
      workflowId,
      workflowDocument,
      ...(args?.documentFormat ? { documentFormat: args.documentFormat } : {}),
      ...(currentWorkflowState ? { currentWorkflowState } : {}),
    }
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
      const requestedWorkflowId = args?.workflowId?.trim()
      if (!requestedWorkflowId) {
        throw new Error('workflowId is required for edit_workflow')
      }

      // Resolve workflowId
      const { workflowId, workflowName, workspaceId } = await resolveWorkflowTarget(
        executionContext,
        {
          workflowId: requestedWorkflowId,
        }
      )
      this.lastWorkflowId = workflowId

      let currentWorkflowState: string | undefined

      try {
        currentWorkflowState = JSON.stringify(
          (await getReadableWorkflowState(executionContext, workflowId)).workflowState
        )
      } catch (e) {
        logger.warn('Failed to build currentWorkflowState from readable workflow snapshot', e as any)
        throw new Error('Failed to read the current workflow')
      }

      const fallbackWorkflowDocument = args?.workflowDocument?.trim()
      const result = (await executeCopilotServerTool({
        toolName: this.getServerToolName(),
        payload: this.buildServerPayload(workflowId, args, currentWorkflowState),
      })) as any
      if (!result.workflowState) {
        throw new Error('No workflow state returned from server')
      }

      this.lastResult = {
        ...result,
        ...buildWorkflowDocumentToolResult({
          workflowId,
          workflowName,
          workspaceId,
          workflowDocument:
            typeof result?.workflowDocument === 'string'
              ? result.workflowDocument
              : fallbackWorkflowDocument || '',
        }),
      }
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
      this.setState(ClientToolCallState.review, { result: this.lastResult })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
