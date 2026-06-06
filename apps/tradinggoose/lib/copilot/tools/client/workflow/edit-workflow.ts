import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  type BaseClientToolMetadata,
  ClientToolCallState,
  StagedReviewClientTool,
} from '@/lib/copilot/tools/client/base-tool'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import {
  buildWorkflowDocumentToolResult,
  getReadableWorkflowState,
  resolveWorkflowTarget,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import { createLogger } from '@/lib/logs/console/logger'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { setWorkflowState } from '@/lib/yjs/workflow-session'
import { acquireWritableWorkflowSessionLease } from '@/lib/yjs/workflow-shared-session'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'

interface EditWorkflowArgs {
  entityDocument: string
  documentFormat?: string
  entityId?: string
}

function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
}

export class EditWorkflowClientTool extends StagedReviewClientTool<Record<string, any>> {
  static readonly id: string = 'edit_workflow'
  private hasExecuted = false
  private hasAppliedState = false

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

  async handleAccept(args?: EditWorkflowArgs): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    try {
      const stagedResult = this.getStagedReviewResult()
      logger.info('handleAccept called', {
        toolCallId: this.toolCallId,
        state: this.getState(),
        hasResult: stagedResult !== undefined,
      })

      if (!stagedResult?.workflowState) {
        throw new Error('No staged workflow edits found to accept')
      }

      const executionContext = this.requireExecutionContext()
      const resolvedArgs = args || readStoredToolArgs<EditWorkflowArgs>(this.toolCallId)
      const requestedEntityId =
        resolvedArgs?.entityId?.trim() ??
        (typeof stagedResult?.entityId === 'string' ? stagedResult.entityId.trim() : undefined)
      if (!requestedEntityId) {
        throw new Error('entityId is required for edit_workflow')
      }
      const { workflowId } = await resolveWorkflowTarget(executionContext, {
        entityId: requestedEntityId,
      })
      const lease = await acquireWritableWorkflowSessionLease({
        workflowId,
        workspaceId:
          (typeof stagedResult.workspaceId === 'string' ? stagedResult.workspaceId : undefined) ??
          executionContext.workspaceId ??
          null,
      })

      try {
        if (!this.hasAppliedState) {
          setWorkflowState(
            lease.session.doc,
            stagedResult.workflowState,
            YJS_ORIGINS.COPILOT_REVIEW_ACCEPT
          )
          this.hasAppliedState = true
        }
      } finally {
        lease.release()
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

  protected getServerToolName(): string {
    return EditWorkflowClientTool.id
  }

  protected buildServerPayload(
    workflowId: string,
    args: Record<string, any> | undefined,
    currentWorkflowState: string
  ): Record<string, any> {
    const entityDocument = args?.entityDocument?.trim()
    if (!entityDocument) {
      throw new Error(`No entityDocument provided for ${this.getServerToolName()}`)
    }

    return {
      entityId: workflowId,
      entityDocument,
      ...(args?.documentFormat ? { documentFormat: args.documentFormat } : {}),
      currentWorkflowState,
    }
  }

  protected hasStagedReviewResult(result: Record<string, any> | undefined): boolean {
    return !!result?.workflowState
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
      const requestedEntityId = requireCopilotEntityId(args, { toolName: 'edit_workflow' })

      const { workflowId, workspaceId } = await resolveWorkflowTarget(executionContext, {
        entityId: requestedEntityId,
      })

      const readableWorkflow = await getReadableWorkflowState(executionContext, workflowId)

      const result = (await executeCopilotServerTool({
        toolName: this.getServerToolName(),
        payload: this.buildServerPayload(
          workflowId,
          args,
          JSON.stringify(readableWorkflow.workflowState)
        ),
        signal: this.getAbortSignal(),
      })) as any
      if (!result.workflowState) {
        throw new Error('No workflow state returned from server')
      }
      if (typeof result.entityDocument !== 'string') {
        throw new Error('No workflow document returned from server')
      }

      const stagedResult = {
        ...result,
        ...buildWorkflowDocumentToolResult({
          workflowId,
          entityName: readableWorkflow.entityName,
          workspaceId: readableWorkflow.workspaceId ?? workspaceId,
          entityDocument: result.entityDocument,
        }),
      }
      this.hasAppliedState = false
      logger.info('server result parsed', {
        hasWorkflowState: !!result?.workflowState,
        blocksCount: result?.workflowState
          ? Object.keys(result.workflowState.blocks || {}).length
          : 0,
      })

      this.stageReviewResult(stagedResult)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      await this.markToolComplete(getCopilotServerToolErrorStatus(error) ?? 500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
