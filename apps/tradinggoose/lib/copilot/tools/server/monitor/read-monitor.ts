import { getMonitorRowById, toMonitorRecord } from '@/app/api/monitors/shared'
import {
  buildMonitorDocumentEnvelope,
  type MonitorRecord,
} from '@/lib/copilot/tools/server/monitor/shared'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

type ReadMonitorArgs = {
  monitorId: string
}

export const readMonitorServerTool: BaseServerTool<ReadMonitorArgs> = {
  name: 'read_monitor',
  async execute(args, context) {
    const userId = context?.userId?.trim()
    if (!userId) {
      throw new Error('Authenticated user is required to read monitors')
    }

    const row = await getMonitorRowById(args.monitorId)
    if (!row) {
      throw new Error('Monitor not found')
    }
    const workspaceId = row.workflow.workspaceId
    if (!workspaceId) {
      throw new Error('Monitor workspace is missing')
    }

    const access = await checkWorkspaceAccess(workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      throw new Error('Access denied: You do not have permission to read this monitor')
    }

    const monitor = (await toMonitorRecord(row.webhook)) as MonitorRecord
    return { ...buildMonitorDocumentEnvelope(monitor), workspaceId }
  },
}
