import { Check, Grid2x2, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'

type CreateWorkflowArgs = {
  name?: string
  description?: string
  color?: string
  folderId?: string | null
  workspaceId?: string
}

function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
}

export class CreateWorkflowClientTool extends BaseClientTool {
  static readonly id = 'create_workflow'
  private currentArgs?: CreateWorkflowArgs

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Creating workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Create workflow?', icon: Grid2x2 },
      [ClientToolCallState.executing]: { text: 'Creating workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Created workflow', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to create workflow', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted creating workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped creating workflow', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
  }

  constructor(toolCallId: string) {
    super(toolCallId, CreateWorkflowClientTool.id, CreateWorkflowClientTool.metadata)
  }

  async execute(args?: CreateWorkflowArgs): Promise<void> {
    this.currentArgs = args
  }

  async handleAccept(args?: CreateWorkflowArgs): Promise<void> {
    const logger = createLogger('CreateWorkflowClientTool')

    try {
      this.setState(ClientToolCallState.executing)

      const executionContext = this.requireExecutionContext()
      const resolvedArgs =
        args || this.currentArgs || readStoredToolArgs<CreateWorkflowArgs>(this.toolCallId)
      const workspaceId =
        resolvedArgs?.workspaceId?.trim() || executionContext.workspaceId?.trim() || undefined

      if (!workspaceId) {
        throw new Error('workspaceId is required to create a workflow')
      }

      const workflowId = await useWorkflowRegistry.getState().createWorkflow({
        workspaceId,
        ...(resolvedArgs?.name?.trim() ? { name: resolvedArgs.name.trim() } : {}),
        ...(typeof resolvedArgs?.description === 'string'
          ? { description: resolvedArgs.description }
          : {}),
        ...(typeof resolvedArgs?.color === 'string' ? { color: resolvedArgs.color } : {}),
        ...(resolvedArgs?.folderId !== undefined ? { folderId: resolvedArgs.folderId } : {}),
      })

      const workflow = useWorkflowRegistry.getState().workflows[workflowId]
      const workflowName =
        workflow?.name?.trim() || resolvedArgs?.name?.trim() || 'Untitled Workflow'

      await this.markToolComplete(200, 'Workflow created', {
        success: true,
        entityKind: 'workflow',
        entityId: workflowId,
        entityName: workflowName,
        workflowId,
        workflowName,
        workspaceId: workflow?.workspaceId ?? workspaceId,
      })
      this.setState(ClientToolCallState.success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to create workflow', { toolCallId: this.toolCallId, message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
