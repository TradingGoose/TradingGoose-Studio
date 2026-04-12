import { FileJson, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  getMonitorDocumentName,
  MONITOR_DOCUMENT_FORMAT,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import {
  fetchMonitorById,
  type ReadMonitorArgs,
  toMonitorDocumentFields,
} from '@/lib/copilot/tools/client/monitor/monitor-tool-utils'

export class GetMonitorClientTool extends BaseClientTool {
  static readonly id = 'get_monitor'

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading monitor document', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Read monitor document', icon: FileJson },
      [ClientToolCallState.executing]: { text: 'Reading monitor document', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read monitor document', icon: FileJson },
      [ClientToolCallState.error]: { text: 'Failed to read monitor document', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted reading monitor document', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped reading monitor document', icon: XCircle },
    },
  }

  constructor(toolCallId: string) {
    super(toolCallId, GetMonitorClientTool.id, GetMonitorClientTool.metadata)
  }

  async execute(args?: ReadMonitorArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      if (!args?.entityId?.trim()) {
        throw new Error('entityId is required')
      }

      const monitor = await fetchMonitorById(args.entityId)
      const fields = toMonitorDocumentFields(monitor)

      await this.markToolComplete(200, 'Monitor document ready', {
        entityKind: 'monitor',
        entityId: monitor.monitorId,
        entityName: getMonitorDocumentName(fields),
        documentFormat: MONITOR_DOCUMENT_FORMAT,
        entityDocument: serializeMonitorDocument(fields),
      })
      this.setState(ClientToolCallState.success)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
