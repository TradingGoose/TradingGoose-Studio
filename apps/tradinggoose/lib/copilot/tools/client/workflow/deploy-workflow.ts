import { Loader2, Rocket, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { resolveWorkflowTarget } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface DeployWorkflowArgs {
  action: 'deploy' | 'undeploy'
  deployType?: 'api' | 'chat'
  entityId: string
}

export class DeployWorkflowClientTool extends BaseClientTool {
  static readonly id = 'deploy_workflow'

  private chatOpened = false
  private chatOpening = false

  constructor(toolCallId: string) {
    super(toolCallId, DeployWorkflowClientTool.id, DeployWorkflowClientTool.metadata)
  }

  /**
   * Override to provide dynamic button text based on action and deployType
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    // Get params from the copilot store
    const toolCallsById = getCopilotStoreForToolCall(this.toolCallId).getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as DeployWorkflowArgs | undefined

    const action = params?.action || 'deploy'
    const deployType = params?.deployType || 'api'
    // Check if workflow is already deployed
    const workflowId = params?.entityId?.trim()
    const isAlreadyDeployed = workflowId
      ? useWorkflowRegistry.getState().readWorkflowDeploymentStatus(workflowId)?.isDeployed
      : false

    let buttonText = action.charAt(0).toUpperCase() + action.slice(1)

    // Change to "Redeploy" if already deployed
    if (action === 'deploy' && isAlreadyDeployed) {
      buttonText = 'Redeploy'
    } else if (action === 'deploy' && deployType === 'chat') {
      buttonText = 'Deploy as chat'
    }

    return {
      accept: { text: buttonText, icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to deploy workflow',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Deploy workflow?', icon: Rocket },
      [ClientToolCallState.executing]: { text: 'Deploying workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Deployed workflow', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to deploy workflow', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted deploying workflow',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped deploying workflow',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Deploy', icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const action = params?.action === 'undeploy' ? 'undeploy' : 'deploy'
      const deployType = params?.deployType || 'api'

      // Check if workflow is already deployed
      const workflowId = params?.entityId
      const isAlreadyDeployed = workflowId
        ? useWorkflowRegistry.getState().readWorkflowDeploymentStatus(workflowId)?.isDeployed
        : false

      // Determine action text based on deployment status
      let actionText = action
      let actionTextIng = action === 'undeploy' ? 'undeploying' : 'deploying'

      // If already deployed and action is deploy, change to redeploy
      if (action === 'deploy' && isAlreadyDeployed) {
        actionText = 'redeploy'
        actionTextIng = 'redeploying'
      }

      const actionCapitalized = actionText.charAt(0).toUpperCase() + actionText.slice(1)

      // Special text for chat deployment
      const isChatDeploy = action === 'deploy' && deployType === 'chat'
      const displayAction = isChatDeploy ? 'deploy as chat' : actionText
      const displayActionCapitalized = isChatDeploy ? 'Deploy as chat' : actionCapitalized

      switch (state) {
        case ClientToolCallState.success:
          return isChatDeploy
            ? 'Opened chat deployment settings'
            : `${actionCapitalized}ed workflow`
        case ClientToolCallState.executing:
          return isChatDeploy
            ? 'Opening chat deployment settings'
            : `${actionCapitalized}ing workflow`
        case ClientToolCallState.generating:
          return `Preparing to ${displayAction} workflow`
        case ClientToolCallState.pending:
          return `${displayActionCapitalized} workflow?`
        case ClientToolCallState.error:
          return `Failed to ${displayAction} workflow`
        case ClientToolCallState.aborted:
          return isChatDeploy
            ? 'Aborted opening chat deployment'
            : `Aborted ${actionTextIng} workflow`
        case ClientToolCallState.rejected:
          return isChatDeploy
            ? 'Skipped opening chat deployment'
            : `Skipped ${actionTextIng} workflow`
      }
      return undefined
    },
  }

  /**
   * Checks if the user has any API keys (workspace or personal)
   */
  private async hasApiKeys(workspaceId: string): Promise<boolean> {
    try {
      const [workspaceRes, personalRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/api-keys`),
        fetch('/api/users/me/api-keys'),
      ])

      if (!workspaceRes.ok || !personalRes.ok) {
        return false
      }

      const workspaceData = await workspaceRes.json()
      const personalData = await personalRes.json()

      const workspaceKeys = (workspaceData?.keys || []) as Array<any>
      const personalKeys = (personalData?.keys || []) as Array<any>

      return workspaceKeys.length > 0 || personalKeys.length > 0
    } catch (error) {
      const logger = createLogger('DeployWorkflowClientTool')
      logger.warn('Failed to check API keys:', error)
      return false
    }
  }

  /**
   * Opens the workspace API keys page.
   */
  private openApiKeysPage(workspaceId: string): void {
    window.location.assign(`/workspace/${encodeURIComponent(workspaceId)}/api-keys`)
  }

  async handleAccept(args?: DeployWorkflowArgs): Promise<void> {
    const logger = createLogger('DeployWorkflowClientTool')
    try {
      const executionContext = this.requireExecutionContext()
      const action = args?.action || 'deploy'
      const deployType = args?.deployType || 'api'
      const entityId = requireCopilotEntityId(args)
      const { workflowId, workspaceId } = await resolveWorkflowTarget(executionContext, {
        entityId,
        signal: this.getAbortSignal(),
      })

      if (action === 'deploy' && deployType === 'chat') {
        if (
          this.chatOpened ||
          this.chatOpening ||
          this.hasSubmittedResult() ||
          this.resolveResult<{ opened?: boolean }>()?.opened
        )
          return
        if (!workspaceId) throw new Error('Workflow workspace not found')
        this.chatOpening = true
        try {
          await this.requireNativeTarget()
          this.getAbortSignal()?.throwIfAborted()
          this.setState(ClientToolCallState.executing)
          await getCopilotStoreForToolCall(this.toolCallId)
            .getState()
            .openWorkflowChatDeployment(this.toolCallId, { workflowId, workspaceId })
          this.chatOpened = true
          const result = {
            opened: true,
            surface: 'chat-deployment' as const,
            message: 'Opened chat deployment settings',
          }
          this.setState(ClientToolCallState.executing, { result })
          await this.completeBrowserAssertion({ kind: 'ui.opened', data: result })
          this.setState(ClientToolCallState.success, { result })
        } finally {
          this.chatOpening = false
        }
        return
      }

      // For deploy action, check if user has API keys first
      if (action === 'deploy') {
        if (!workspaceId) {
          throw new Error('Workflow workspace not found')
        }

        const hasKeys = await this.hasApiKeys(workspaceId)

        if (!hasKeys) {
          // Mark as rejected since we can't deploy without an API key
          this.setState(ClientToolCallState.rejected)

          // Open the workspace API keys page to help user create one
          this.openApiKeysPage(workspaceId)

          await this.completeBrowserAssertion({
            kind: 'ui.opened',
            data: { opened: true, surface: 'api-key-settings', message: 'Opened API key settings' },
          })
          return
        }
      }

      this.setState(ClientToolCallState.executing)

      // Perform the deploy/undeploy action
      const endpoint = `/api/workflows/${workflowId}/deploy`
      const method = action === 'deploy' ? 'POST' : 'DELETE'

      const native = await this.requireNativeTarget()
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ native }),
        signal: this.getAbortSignal(),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }

      const json = await res.json()

      this.setState(ClientToolCallState.success)
      await this.completeAuthoritativeReadback()

      // Refresh the workflow registry to update deployment status
      try {
        const setDeploymentStatus = useWorkflowRegistry.getState().setDeploymentStatus
        if (action === 'deploy') {
          setDeploymentStatus(
            workflowId,
            true,
            json.deployedAt ? new Date(json.deployedAt) : undefined,
            json.apiKey || ''
          )
        } else {
          setDeploymentStatus(workflowId, false, undefined, '')
        }
        const actionPast = action === 'undeploy' ? 'undeployed' : 'deployed'
        logger.info(`Workflow ${actionPast} and registry updated`)
      } catch (error) {
        logger.warn('Failed to update workflow registry:', error)
      }
    } catch (e: any) {
      logger.error('Deploy/undeploy failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      this.fail(
        this.chatOpened
          ? 'Chat deployment settings opened; native acknowledgement failed'
          : e?.message || 'Failed to deploy/undeploy workflow'
      )
    }
  }

  async execute(args?: DeployWorkflowArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
