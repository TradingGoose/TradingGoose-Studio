import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import {
  buildMonitorListEntry,
  type MonitorRecord,
} from '@/lib/copilot/tools/server/monitor/shared'
import { getListingIdentityKey } from '@/lib/listing/identity'
import { resolveListingIdentities } from '@/lib/listing/resolve'
import { listMonitorRows, toMonitorRecord } from '@/app/api/monitors/shared'

type ListMonitorsArgs = {
  workspaceId: string
  entityId?: string
  blockId?: string
}

export const listMonitorsServerTool: BaseServerTool<ListMonitorsArgs> = {
  name: 'list_monitors',
  async execute(args, context) {
    const executionContext = withWorkspaceArgContext(context, args)
    const { workspaceId } = await verifyWorkspaceContext(executionContext, 'read')

    const rows = await listMonitorRows({
      workspaceId,
      workflowId: args.entityId,
      blockId: args.blockId,
    })
    const monitors = (await Promise.all(
      rows.map((row) => toMonitorRecord(row.webhook))
    )) as MonitorRecord[]
    const listings = monitors.flatMap((monitor) => {
      const listing = monitor.providerConfig.monitor.listing
      return listing ? [listing] : []
    })
    const resolvedListings = await resolveListingIdentities(listings, context?.signal)
    const monitorEntries = monitors.map((monitor) => {
      const listing = monitor.providerConfig.monitor.listing
      const resolvedListing = listing
        ? (resolvedListings[getListingIdentityKey(listing)] ?? null)
        : null
      return buildMonitorListEntry(monitor, resolvedListing)
    })

    return {
      surfaceKind: 'monitor' as const,
      workspaceId,
      monitors: monitorEntries,
      count: monitorEntries.length,
    }
  },
}
