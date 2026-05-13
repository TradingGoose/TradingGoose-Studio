import { CheckCircle, FolderOpen, Loader2, MinusCircle, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

export class GDriveRequestAccessClientTool extends BaseClientTool {
  static readonly id = 'gdrive_request_access'

  constructor(toolCallId: string) {
    super(toolCallId, GDriveRequestAccessClientTool.id, GDriveRequestAccessClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Requesting GDrive access', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Requesting GDrive access', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Requesting GDrive access', icon: Loader2 },
      [ClientToolCallState.rejected]: { text: 'Skipped GDrive access', icon: MinusCircle },
      [ClientToolCallState.success]: { text: 'GDrive access granted', icon: CheckCircle },
      [ClientToolCallState.error]: { text: 'Failed to request GDrive access', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted GDrive access request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Select', icon: FolderOpen },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async handleAccept(): Promise<void> {
    const logger = createLogger('GDriveRequestAccessClientTool')
    logger.debug('handleAccept() called', { toolCallId: this.toolCallId })

    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()
      const params = new URLSearchParams({ provider: 'google-drive' })
      const workflowId =
        executionContext.contextWorkflowId?.trim() || executionContext.workflowId?.trim()
      if (workflowId) {
        params.set('workflowId', workflowId)
      } else if (executionContext.workspaceId?.trim()) {
        params.set('workspaceId', executionContext.workspaceId.trim())
      } else {
        throw new Error('workspaceId or workflowId is required to request Google Drive access')
      }

      const credsRes = await fetch(`/api/auth/oauth/credentials?${params}`)
      if (!credsRes.ok) {
        throw new Error(`Failed to load OAuth credentials (${credsRes.status})`)
      }
      const credsData = await credsRes.json()
      const creds = Array.isArray(credsData.credentials) ? credsData.credentials : []
      if (creds.length === 0) {
        throw new Error('No OAuth credentials found')
      }
      const defaultCred = creds.find((c: any) => c.isDefault) || creds[0]

      await this.markToolComplete(200, { granted: true, credentialId: defaultCred.id })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async execute(): Promise<void> {
    await this.handleAccept()
  }
}
