'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'
import Workflow from '@/widgets/widgets/editor_workflow/components/workflow'
import type { WorkflowCanvasUIConfig } from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface WorkflowEditorAppProps {
  workspaceId: string
  workflowId: string
  ui?: WorkflowCanvasUIConfig
  disableNavigation?: boolean
  channelId?: string
  toolbarScopeId?: string
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

const WorkflowEditorApp = ({
  workspaceId,
  workflowId,
  ui,
  disableNavigation,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  toolbarScopeId,
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
    <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
      <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId} channelId={channelId}>
        <Workflow
          key={workflowRenderKey}
          channelId={channelId}
          toolbarScopeId={toolbarScopeId}
          ui={ui}
          disableNavigation={disableNavigation}
          viewportBounds={viewportBounds}
        />
      </WorkflowRouteProvider>
    </WorkflowSessionProvider>
  )
}

export default WorkflowEditorApp
export { WorkflowEditorApp }
