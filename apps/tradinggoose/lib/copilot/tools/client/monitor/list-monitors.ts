import { Activity, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { resolveWorkspaceIdFromExecutionContext } from '@/lib/copilot/tools/client/entities/entity-document-tool-utils'
import {
  buildMonitorName,
  type IndicatorMonitorRecord,
  type ListMonitorArgs,
} from '@/lib/copilot/tools/client/monitor/monitor-tool-utils'

export class ListMonitorsClientTool extends BaseClientTool {
  static readonly id = 'list_monitors'

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing monitors', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'List monitors', icon: Activity },
      [ClientToolCallState.executing]: { text: 'Listing monitors', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Listed monitors', icon: Activity },
      [ClientToolCallState.error]: { text: 'Failed to list monitors', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted listing monitors', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing monitors', icon: XCircle },
    },
  }

  constructor(toolCallId: string) {
    super(toolCallId, ListMonitorsClientTool.id, ListMonitorsClientTool.metadata)
  }

  async execute(args?: ListMonitorArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
      const searchParams = new URLSearchParams({ workspaceId })

      if (args?.workflowId) {
        searchParams.set('workflowId', args.workflowId)
      }
      if (args?.blockId) {
        searchParams.set('blockId', args.blockId)
      }

      const response = await fetch(`/api/indicator-monitors?${searchParams.toString()}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to fetch monitors: ${response.status}`)
      }

      const monitors = Array.isArray(payload?.data) ? (payload.data as IndicatorMonitorRecord[]) : []
      const entities = monitors.map((monitor) => ({
        id: monitor.monitorId,
        name: buildMonitorName(monitor),
        description: `Workflow ${monitor.workflowId}, block ${monitor.blockId}`,
        workflowId: monitor.workflowId,
        blockId: monitor.blockId,
        providerId: monitor.providerConfig.monitor.providerId,
        indicatorId: monitor.providerConfig.monitor.indicatorId,
        interval: monitor.providerConfig.monitor.interval,
        isActive: monitor.isActive,
        createdAt: monitor.createdAt,
        updatedAt: monitor.updatedAt,
      }))

      await this.markToolComplete(200, 'Listed monitors', {
        entityKind: 'monitor',
        entities,
        count: entities.length,
      })
      this.setState(ClientToolCallState.success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
