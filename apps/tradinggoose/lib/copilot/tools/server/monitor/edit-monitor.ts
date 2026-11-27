import { MONITOR_DOCUMENT_FORMAT } from '@/lib/copilot/document-formats'
import {
  parseMonitorDocument,
  readMonitorDocumentName,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import {
  type BaseServerTool,
  shouldStageServerToolMutationForReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import {
  buildMonitorDocumentEnvelope,
  type MonitorRecord,
  resolveMonitorListingPresentation,
  toMonitorDocumentFields,
} from '@/lib/copilot/tools/server/monitor/shared'
import { createLogger } from '@/lib/logs/console/logger'
import { getMonitorRowById, toMonitorRecord } from '@/app/api/monitors/shared'
import { getMonitorReviewBaseHash, updateMonitorForUser } from '@/app/api/monitors/update-service'

const logger = createLogger('EditMonitorServerTool')

type EditMonitorArgs = {
  monitorId: string
  monitorDocument: string
  documentFormat?: string
}

export const editMonitorServerTool: BaseServerTool<EditMonitorArgs> = {
  name: 'edit_monitor',
  async execute(args, context) {
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
    const { userId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, { workspaceId: row.workflow.workspaceId }),
      'write'
    )

    const nextFields = parseMonitorDocument(args.monitorDocument)
    const nextListing = 'listing' in nextFields ? nextFields.listing : undefined
    if (shouldStageServerToolMutationForReview(context)) {
      const currentDocument = serializeMonitorDocument(
        toMonitorDocumentFields(toMonitorRecord(row.webhook) as MonitorRecord)
      )
      const nextDocument = serializeMonitorDocument(nextFields)
      const resolvedListing = await resolveMonitorListingPresentation(nextListing, context?.signal)
      return {
        requiresReview: true,
        success: true,
        surfaceKind: 'monitor' as const,
        workspaceId: row.workflow.workspaceId,
        monitorId: args.monitorId,
        monitorName: readMonitorDocumentName(nextFields, resolvedListing),
        documentFormat: MONITOR_DOCUMENT_FORMAT,
        monitorDocument: nextDocument,
        reviewBaseStateHash: getMonitorReviewBaseHash(row.webhook),
        preview: {
          documentDiff: {
            before: currentDocument,
            after: nextDocument,
          },
        },
      }
    }

    const updatedMonitor = (await updateMonitorForUser({
      monitorId: args.monitorId,
      userId,
      body: {
        ...nextFields,
        workspaceId: row.workflow.workspaceId,
      },
      acceptedReviewBaseStateHash: context?.acceptedReviewBaseStateHash,
      requestId: crypto.randomUUID(),
      logger,
    })) as MonitorRecord
    const resolvedListing = await resolveMonitorListingPresentation(nextListing, context?.signal)

    return {
      ...buildMonitorDocumentEnvelope(updatedMonitor, resolvedListing, true),
      workspaceId: row.workflow.workspaceId,
    }
  },
}
