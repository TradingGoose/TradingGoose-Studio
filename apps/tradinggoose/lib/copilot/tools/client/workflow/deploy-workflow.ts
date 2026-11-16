import { Loader2, Rocket, X, XCircle } from 'lucide-react'
import type { z } from 'zod'
import { ToolArgSchemas } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { resolveWorkflowTarget } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type DeployWorkflowArgs = z.infer<typeof ToolArgSchemas.deploy_workflow>

function deploymentAction(params?: Partial<DeployWorkflowArgs>) {
  if (params?.action === 'undeploy') return 'Undeploy'
  return params?.entityId &&
    useWorkflowRegistry.getState().readWorkflowDeploymentStatus(params.entityId)?.isDeployed
    ? 'Redeploy'
    : 'Deploy'
}

export class DeployWorkflowClientTool extends BaseClientTool {
  private chatOpened = false
  private chatOpening = false

  constructor(toolCallId: string) {
    super(toolCallId, DeployWorkflowClientTool.metadata)
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] {
    const params = getCopilotStoreForToolCall(this.toolCallId).getState().toolCallsById[
      this.toolCallId
    ]?.params as DeployWorkflowArgs | undefined
    const action = deploymentAction(params)
    return {
      accept: {
        text: action === 'Deploy' && params?.deployType === 'chat' ? 'Deploy as chat' : action,
        icon: Rocket,
      },
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
      const action = deploymentAction(params)
      const isChatDeploy = params.action !== 'undeploy' && params.deployType === 'chat'
      const displayAction = isChatDeploy ? 'Deploy as chat' : action

      switch (state) {
        case ClientToolCallState.success:
          return isChatDeploy ? 'Opened chat deployment settings' : `${action}ed workflow`
        case ClientToolCallState.executing:
          return isChatDeploy ? 'Opening chat deployment settings' : `${action}ing workflow`
        case ClientToolCallState.generating:
          return `Preparing to ${displayAction.toLowerCase()} workflow`
        case ClientToolCallState.pending:
          return `${displayAction} workflow?`
        case ClientToolCallState.error:
          return `Failed to ${displayAction.toLowerCase()} workflow`
        case ClientToolCallState.aborted:
          return isChatDeploy
            ? 'Aborted opening chat deployment'
            : `Aborted ${action.toLowerCase()}ing workflow`
        case ClientToolCallState.rejected:
          return isChatDeploy
            ? 'Skipped opening chat deployment'
            : `Skipped ${action.toLowerCase()}ing workflow`
      }
      return undefined
    },
  }

  async execute(args?: DeployWorkflowArgs): Promise<void> {
    const logger = createLogger('DeployWorkflowClientTool')
    try {
      const { action, deployType, entityId } = ToolArgSchemas.deploy_workflow.parse(args)

      if (action === 'deploy' && deployType === 'chat') {
        if (
          this.chatOpened ||
          this.chatOpening ||
          this.hasSubmittedResult() ||
          this.resolveResult<{ opened?: boolean }>()?.opened
        )
          return
        this.chatOpening = true
        try {
          const { workflowId, workspaceId } = await resolveWorkflowTarget(
            this.requireExecutionContext(),
            { entityId, signal: this.getAbortSignal() }
          )
          if (!workspaceId) throw new Error('Workflow workspace not found')
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

      this.setState(ClientToolCallState.executing)

      const native = await this.requireNativeTarget()
      const res = await fetch(`/api/workflows/${entityId}/deploy`, {
        method: action === 'deploy' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ native }),
        signal: this.getAbortSignal(),
      })

      const json = await res.json()
      if (!res.ok) {
        if (
          action === 'deploy' &&
          deployType === 'api' &&
          res.status === 400 &&
          json?.needsApiKey === true
        ) {
          await this.completeAuthoritativeReadback()
          return
        }
        throw new Error(
          typeof json?.error === 'string' ? json.error : `Server error (${res.status})`
        )
      }

      await this.completeAuthoritativeReadback()
      this.setState(ClientToolCallState.success)

      try {
        const deployed = action === 'deploy'
        useWorkflowRegistry
          .getState()
          .setDeploymentStatus(
            entityId,
            deployed,
            deployed ? new Date(json.deployedAt) : undefined,
            deployed ? json.apiKey : ''
          )
      } catch (error) {
        logger.warn('Failed to update workflow registry:', error)
      }
    } catch (e: any) {
      logger.error('Deploy/undeploy failed', { message: e?.message })
      this.fail(
        this.chatOpened
          ? 'Chat deployment settings opened; native acknowledgement failed'
          : e?.message || 'Failed to deploy/undeploy workflow'
      )
    }
  }
}
