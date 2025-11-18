'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { SocketProvider } from '@/contexts/socket-context'
import { WorkflowRouteProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import Workflow, { type WorkflowUIConfig } from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import {
  WorkflowStoreProvider,
  DEFAULT_WORKFLOW_CHANNEL_ID,
} from '@/stores/workflows/workflow/store'

interface WorkflowEditorAppProps {
  workspaceId: string
  workflowId: string
  ui?: WorkflowUIConfig
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
        <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId} channelId={channelId}>
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
