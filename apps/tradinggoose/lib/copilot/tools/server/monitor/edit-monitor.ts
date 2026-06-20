import { getMonitorRowById } from '@/app/api/monitors/shared'
import { updateMonitorForUser } from '@/app/api/monitors/update-service'
import {
  MONITOR_DOCUMENT_FORMAT,
  parseMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import {
  buildMonitorDocumentEnvelope,
  type MonitorRecord,
} from '@/lib/copilot/tools/server/monitor/shared'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('EditMonitorServerTool')

type EditMonitorArgs = {
  monitorId: string
  monitorDocument: string
  documentFormat?: string
}

export const editMonitorServerTool: BaseServerTool<EditMonitorArgs> = {
  name: 'edit_monitor',
  async execute(args, context) {
    const userId = context?.userId?.trim()
    if (!userId) {
      throw new Error('Authenticated user is required to edit monitors')
    }
    if (args.documentFormat && args.documentFormat !== MONITOR_DOCUMENT_FORMAT) {
      throw new Error(
        `Unsupported documentFormat "${args.documentFormat}". Expected ${MONITOR_DOCUMENT_FORMAT}`
      )
    }

    const row = await getMonitorRowById(args.monitorId)
    if (!row) {
      throw new Error('Monitor not found')
    }
    if (!row.workflow.workspaceId) {
      throw new Error('Monitor workspace is missing')
    }

    const nextFields = parseMonitorDocument(args.monitorDocument)
    const updatedMonitor = (await updateMonitorForUser({
      monitorId: args.monitorId,
      userId,
      body: {
        ...nextFields,
        workspaceId: row.workflow.workspaceId,
      },
      requestId: crypto.randomUUID(),
      logger,
    })) as MonitorRecord

    return buildMonitorDocumentEnvelope(updatedMonitor, true)
  },
}
