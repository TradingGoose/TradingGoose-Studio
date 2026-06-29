import {
  MONITOR_DOCUMENT_FORMAT,
  parseMonitorDocument,
  readMonitorDocumentName,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import {
  buildMonitorDocumentEnvelope,
  type MonitorRecord,
} from '@/lib/copilot/tools/server/monitor/shared'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { getMonitorRowById, toMonitorRecord } from '@/app/api/monitors/shared'
import { updateMonitorForUser } from '@/app/api/monitors/update-service'

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
    const currentMonitor = (await toMonitorRecord(row.webhook)) as MonitorRecord
    const currentDocument = buildMonitorDocumentEnvelope(currentMonitor).monitorDocument
    const reviewBaseStateHash = hashServerToolReviewBase(currentDocument)

    if (shouldStageServerToolMutationForReview(context)) {
      const access = await checkWorkspaceAccess(row.workflow.workspaceId, userId)
      if (!access.exists || !access.hasAccess || !access.canWrite) {
        throw new Error('Access denied: You do not have permission to edit this monitor')
      }

      const nextDocument = serializeMonitorDocument(nextFields)
      return {
        requiresReview: true,
        success: true,
        surfaceKind: 'monitor' as const,
        workspaceId: row.workflow.workspaceId,
        monitorId: args.monitorId,
        monitorName: readMonitorDocumentName(nextFields),
        documentFormat: MONITOR_DOCUMENT_FORMAT,
        monitorDocument: nextDocument,
        reviewBaseStateHash,
        preview: {
          documentDiff: {
            before: currentDocument,
            after: nextDocument,
          },
        },
      }
    }

    assertAcceptedServerToolReviewBase(context, reviewBaseStateHash)
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

    return {
      ...buildMonitorDocumentEnvelope(updatedMonitor, true),
      workspaceId: row.workflow.workspaceId,
    }
  },
}
