import { Check, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
      const workflowId = args?.workflowId ?? executionContext.workflowId
      if (!workflowId) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No active workflow found')
        return
      }

      const operations = args?.operations || []
      if (!operations.length) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No operations provided for preview_edit_workflow')
        return
      }

      // Prepare currentUserWorkflow JSON from stores to preserve block IDs
      let currentUserWorkflow = args?.currentUserWorkflow
      const diffStoreState = useWorkflowDiffStore.getState()
      const canUseScopedDiff =
        !diffStoreState.scopeChannelId || diffStoreState.scopeChannelId === executionContext.channelId
      let usedDiffWorkflow = false

      if (
        !currentUserWorkflow &&
        canUseScopedDiff &&
        diffStoreState.isDiffReady &&
        diffStoreState.diffWorkflow
      ) {
        try {
          const diffWorkflow = diffStoreState.diffWorkflow
          const normalizedDiffWorkflow = {
            ...diffWorkflow,
            blocks: diffWorkflow.blocks || {},
            edges: diffWorkflow.edges || [],
            loops: diffWorkflow.loops || {},
            parallels: diffWorkflow.parallels || {},
          }
          currentUserWorkflow = JSON.stringify(normalizedDiffWorkflow)
          usedDiffWorkflow = true
          logger.info('Using diff workflow state as base for preview_edit_workflow', {
            toolCallId: this.toolCallId,
            blocksCount: Object.keys(normalizedDiffWorkflow.blocks).length,
            edgesCount: normalizedDiffWorkflow.edges.length,
          })
        } catch (e) {
          logger.warn('Failed to serialize diff workflow state; falling back to active workflow', e as any)
        }
      }

      if (!currentUserWorkflow && !usedDiffWorkflow) {
        try {
          const workflowStore = useWorkflowStore.getState(executionContext.channelId)
          const fullState = workflowStore.getWorkflowState()
          let merged = fullState
          if (merged?.blocks) {
            merged = { ...merged, blocks: mergeSubblockState(merged.blocks, workflowId as any) }
          }
          if (merged) {
            if (!merged.loops) merged.loops = {}
            if (!merged.parallels) merged.parallels = {}
            if (!merged.edges) merged.edges = []
            if (!merged.blocks) merged.blocks = {}
            currentUserWorkflow = JSON.stringify(merged)
          }
        } catch (e) {
          logger.warn('Failed to build currentUserWorkflow from stores; proceeding without it', e as any)
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

      await this.markToolComplete(200, 'Pre-edit check: SUCCESS', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
