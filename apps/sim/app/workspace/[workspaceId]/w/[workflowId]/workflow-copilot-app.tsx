'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { SocketProvider } from '@/contexts/socket-context'
import { WorkflowRouteProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import { Copilot } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot'
import {
  WorkflowStoreProvider,
  DEFAULT_WORKFLOW_CHANNEL_ID,
} from '@/stores/workflows/workflow/store-client'
import { CopilotStoreProvider } from '@/stores/copilot/store'

interface WorkflowCopilotAppProps {
  workspaceId: string
  workflowId: string
  panelWidth: number
  channelId?: string
}

const WorkflowCopilotApp = ({
  workspaceId,
  workflowId,
  panelWidth,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
}: WorkflowCopilotAppProps) => {
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
            <CopilotStoreProvider channelId={channelId}>
              <div className='flex h-full w-full flex-col overflow-hidden bg-[hsl(var(--workflow-background))]'>
                <Copilot panelWidth={panelWidth} />
              </div>
            </CopilotStoreProvider>
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </SocketProvider>
    </Providers>
  )
}

export default WorkflowCopilotApp
export { WorkflowCopilotApp }
