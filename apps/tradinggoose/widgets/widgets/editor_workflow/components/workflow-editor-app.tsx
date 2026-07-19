'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'
import Workflow from '@/widgets/widgets/editor_workflow/components/workflow'
import type { WorkflowCanvasUIConfig } from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface WorkflowEditorAppProps {
  workspaceId: string
  workflowId: string
  ui?: WorkflowCanvasUIConfig
  channelId?: string
  toolbarScopeId?: string
  canWrite: boolean
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

const WorkflowEditorApp = ({
  workspaceId,
  workflowId,
  ui,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  toolbarScopeId,
  canWrite,
  viewportBounds,
}: WorkflowEditorAppProps) => {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined
  const workflowRenderKey = `${channelId}:${workflowId}`

  return (
    <Providers workspaceId={workspaceId} inheritUser>
      <WorkflowSessionProvider
        workspaceId={workspaceId}
        workflowId={workflowId}
        user={user}
        canWrite={canWrite}
      >
        <WorkflowRouteProvider
          workspaceId={workspaceId}
          workflowId={workflowId}
          channelId={channelId}
        >
          <Workflow
            key={workflowRenderKey}
            channelId={channelId}
            toolbarScopeId={toolbarScopeId}
            ui={ui}
            viewportBounds={viewportBounds}
          />
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

export default WorkflowEditorApp
export { WorkflowEditorApp }
