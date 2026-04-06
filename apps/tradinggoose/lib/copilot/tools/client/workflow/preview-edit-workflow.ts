import { Check, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveWorkflowIdFromExecutionContext,
  serializeReadableWorkflowSnapshot,
} from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'

interface PreviewEditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

interface PreviewEditWorkflowArgs {
  operations: PreviewEditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

export class PreviewEditWorkflowClientTool extends BaseClientTool {
  static readonly id = 'preview_edit_workflow'
  private hasExecuted = false

  constructor(toolCallId: string) {
    super(toolCallId, PreviewEditWorkflowClientTool.id, PreviewEditWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Pre-edit check', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Pre-edit check', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Pre-edit check', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Pre-edit check: SUCCESS', icon: Check },
      [ClientToolCallState.error]: { text: 'Pre-edit check: FAILED', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Pre-edit check: FAILED', icon: XCircle },
    },
  }

  async execute(args?: PreviewEditWorkflowArgs): Promise<void> {
    const logger = createLogger('PreviewEditWorkflowClientTool')
    try {
      if (this.hasExecuted) {
        logger.info('execute skipped (already executed)', { toolCallId: this.toolCallId })
        return
      }
      this.hasExecuted = true
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()

      // Resolve workflowId
      const workflowId = resolveWorkflowIdFromExecutionContext(executionContext, args?.workflowId)

      const operations = args?.operations || []
      if (!operations.length) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No operations provided for preview_edit_workflow')
        return
      }

      // Build the preview baseline from the live Yjs workflow doc when available,
      // but allow read-only previewing to fall back to the persisted workflow.
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
          toolName: 'preview_edit_workflow',
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
      if (!result?.workflowState) {
        throw new Error('No workflow state returned from preview')
      }

      this.setState(ClientToolCallState.success, { result })
      await this.markToolComplete(200, 'Pre-edit check: SUCCESS', result)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
