import { Activity, Check, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  getMonitorDocumentName,
  MONITOR_DOCUMENT_FORMAT,
  parseMonitorDocument,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import { resolveWorkspaceIdFromExecutionContext } from '@/lib/copilot/tools/client/entities/entity-document-tool-utils'
import {
  type EditMonitorArgs,
  type IndicatorMonitorRecord,
  readStoredToolArgs,
  toMonitorDocumentFields,
} from '@/lib/copilot/tools/client/monitor/monitor-tool-utils'

export class EditMonitorClientTool extends BaseClientTool {
  static readonly id = 'edit_monitor'
  private currentArgs?: EditMonitorArgs

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing monitor document', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Edit monitor document?', icon: Activity },
      [ClientToolCallState.executing]: { text: 'Editing monitor document', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited monitor document', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to edit monitor document', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted editing monitor document', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped editing monitor document', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
  }

  constructor(toolCallId: string) {
    super(toolCallId, EditMonitorClientTool.id, EditMonitorClientTool.metadata)
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const args = this.currentArgs || readStoredToolArgs<EditMonitorArgs>(this.toolCallId)
    return args?.entityDocument ? this.metadata.interrupt : undefined
  }

  async execute(args?: EditMonitorArgs): Promise<void> {
    this.currentArgs = args
  }

  async handleAccept(args?: EditMonitorArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const resolvedArgs =
        args || this.currentArgs || readStoredToolArgs<EditMonitorArgs>(this.toolCallId)

      if (!resolvedArgs?.entityId?.trim()) {
        throw new Error('entityId is required')
      }
      if (!resolvedArgs.entityDocument?.trim()) {
        throw new Error('entityDocument is required')
      }
      if (
        resolvedArgs.documentFormat &&
        resolvedArgs.documentFormat !== MONITOR_DOCUMENT_FORMAT
      ) {
        throw new Error(
          `Unsupported documentFormat "${resolvedArgs.documentFormat}". Expected ${MONITOR_DOCUMENT_FORMAT}`
        )
      }

      const executionContext = this.requireExecutionContext()
      const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
      const nextFields = parseMonitorDocument(resolvedArgs.entityDocument)

      const response = await fetch(
        `/api/indicator-monitors/${encodeURIComponent(resolvedArgs.entityId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId,
            workflowId: nextFields.workflowId,
            blockId: nextFields.blockId,
            providerId: nextFields.providerId,
            interval: nextFields.interval,
            indicatorId: nextFields.indicatorId,
            listing: nextFields.listing,
            isActive: nextFields.isActive,
            ...(nextFields.providerParams ? { providerParams: nextFields.providerParams } : {}),
            ...(nextFields.auth ? { auth: nextFields.auth } : {}),
          }),
        }
      )
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to update monitor: ${response.status}`)
      }

      const updatedMonitor =
        payload?.data && typeof payload.data === 'object'
          ? (payload.data as IndicatorMonitorRecord)
          : null

      if (!updatedMonitor) {
        throw new Error('Invalid updated monitor response')
      }

      const persistedFields = toMonitorDocumentFields(updatedMonitor)
      await this.markToolComplete(200, 'Monitor updated', {
        success: true,
        entityKind: 'monitor',
        entityId: updatedMonitor.monitorId,
        entityName: getMonitorDocumentName(persistedFields),
        documentFormat: MONITOR_DOCUMENT_FORMAT,
        entityDocument: serializeMonitorDocument(persistedFields),
      })
      this.setState(ClientToolCallState.success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
