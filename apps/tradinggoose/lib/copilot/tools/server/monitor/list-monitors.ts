import { listMonitorRows, toMonitorRecord } from '@/app/api/monitors/shared'
import { buildMonitorListEntry, type MonitorRecord } from '@/lib/copilot/tools/server/monitor/shared'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

type ListMonitorsArgs = {
  workspaceId: string
  entityId?: string
  blockId?: string
}

export const listMonitorsServerTool: BaseServerTool<ListMonitorsArgs> = {
  name: 'list_monitors',
  async execute(args, context) {
    const executionContext = withWorkspaceArgContext(context, args)
    const userId = executionContext?.userId?.trim()
    const workspaceId = executionContext?.workspaceId?.trim()
    if (!userId || !workspaceId) {
      throw new Error('Authenticated user and workspaceId are required to list monitors')
    }

    const access = await checkWorkspaceAccess(workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      throw new Error('Access denied: You do not have permission to use this workspace')
    }

    const rows = await listMonitorRows({
      workspaceId,
      workflowId: args.entityId,
      blockId: args.blockId,
    })
    const monitors = (await Promise.all(rows.map((row) => toMonitorRecord(row.webhook)))) as MonitorRecord[]
    const monitorEntries = monitors.map(buildMonitorListEntry)

    return {
      surfaceKind: 'monitor' as const,
      workspaceId,
      monitors: monitorEntries,
      count: monitorEntries.length,
    }
  },
}
