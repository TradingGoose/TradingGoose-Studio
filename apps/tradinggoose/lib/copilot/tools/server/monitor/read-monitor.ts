import { type BaseServerTool, withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import {
  buildMonitorDocumentEnvelope,
  type MonitorRecord,
  resolveMonitorListingPresentation,
} from '@/lib/copilot/tools/server/monitor/shared'
import { getMonitorRowById, toMonitorRecord } from '@/app/api/monitors/shared'

type ReadMonitorArgs = {
  monitorId: string
}

export const readMonitorServerTool: BaseServerTool<ReadMonitorArgs> = {
  name: 'read_monitor',
  async execute(args, context) {
    const row = await getMonitorRowById(args.monitorId)
    if (!row) {
      throw new Error('Monitor not found')
    }
    const workspaceId = row.workflow.workspaceId
    if (!workspaceId) {
      throw new Error('Monitor workspace is missing')
    }

    await verifyWorkspaceContext(withWorkspaceArgContext(context, { workspaceId }), 'read')

    const monitor = (await toMonitorRecord(row.webhook)) as MonitorRecord
    const resolvedListing = await resolveMonitorListingPresentation(
      monitor.providerConfig.monitor.listing,
      context?.signal
    )
    return { ...buildMonitorDocumentEnvelope(monitor, resolvedListing), workspaceId }
  },
}
