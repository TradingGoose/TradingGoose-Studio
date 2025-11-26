'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import {
  type WorkflowCanvasUIConfig,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import { SocketProvider } from '@/contexts/socket-context'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  WorkflowStoreProvider,
} from '@/stores/workflows/workflow/store-client'
import Workflow from '@/widgets/widgets/editor_workflow/components/workflow'

interface WorkflowEditorAppProps {
  workspaceId: string
  workflowId: string
  ui?: WorkflowCanvasUIConfig
  disableNavigation?: boolean
  channelId?: string
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

const WorkflowEditorApp = ({
  workspaceId,
  workflowId,
  ui,
  disableNavigation,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
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

  return (
    <Providers workspaceId={workspaceId}>
      <SocketProvider user={user} workspaceId={workspaceId} workflowId={workflowId}>
        <WorkflowRouteProvider
          workspaceId={workspaceId}
          workflowId={workflowId}
          channelId={channelId}
        >
          <WorkflowStoreProvider channelId={channelId}>
            <Workflow
              channelId={channelId}
              ui={ui}
              disableNavigation={disableNavigation}
              viewportBounds={viewportBounds}
            />
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </SocketProvider>
    </Providers>
  )
}

export default WorkflowEditorApp
export { WorkflowEditorApp }
