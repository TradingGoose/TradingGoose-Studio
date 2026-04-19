import { Check, Grid2x2, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'

type RenameWorkflowArgs = {
  workflowId: string
  name: string
}

function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
}

export class RenameWorkflowClientTool extends BaseClientTool {
  static readonly id = 'rename_workflow'
  private currentArgs?: RenameWorkflowArgs

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Renaming workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Rename workflow?', icon: Grid2x2 },
      [ClientToolCallState.executing]: { text: 'Renaming workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Renamed workflow', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to rename workflow', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted renaming workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped renaming workflow', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
  }

  constructor(toolCallId: string) {
    super(toolCallId, RenameWorkflowClientTool.id, RenameWorkflowClientTool.metadata)
  }

  async execute(args?: RenameWorkflowArgs): Promise<void> {
    this.currentArgs = args
  }

  async handleAccept(args?: RenameWorkflowArgs): Promise<void> {
    const logger = createLogger('RenameWorkflowClientTool')

    try {
      this.setState(ClientToolCallState.executing)

      const resolvedArgs =
        args || this.currentArgs || readStoredToolArgs<RenameWorkflowArgs>(this.toolCallId)
      const workflowId = resolvedArgs?.workflowId?.trim()
      const nextName = resolvedArgs?.name?.trim()

      if (!workflowId) {
        throw new Error('workflowId is required')
      }

      if (!nextName) {
        throw new Error('name is required')
      }

      const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nextName,
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to rename workflow: ${response.status}`)
      }

      const updatedWorkflow =
        payload?.workflow && typeof payload.workflow === 'object' ? payload.workflow : null

      if (!updatedWorkflow) {
        throw new Error('Invalid workflow rename response')
      }

      useWorkflowRegistry.setState((state) => {
        const existingWorkflow = state.workflows[workflowId]
        if (!existingWorkflow) {
          return state
        }

        return {
          workflows: {
            ...state.workflows,
            [workflowId]: {
              ...existingWorkflow,
              name: nextName,
              lastModified: updatedWorkflow.updatedAt
                ? new Date(updatedWorkflow.updatedAt)
                : existingWorkflow.lastModified,
            },
          },
        }
      })

      await this.markToolComplete(200, 'Workflow renamed', {
        success: true,
        entityKind: 'workflow',
        entityId: workflowId,
        entityName: nextName,
        workflowId,
        workflowName: nextName,
        workspaceId:
          typeof updatedWorkflow.workspaceId === 'string'
            ? updatedWorkflow.workspaceId
            : useWorkflowRegistry.getState().workflows[workflowId]?.workspaceId,
      })
      this.setState(ClientToolCallState.success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to rename workflow', { toolCallId: this.toolCallId, message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
