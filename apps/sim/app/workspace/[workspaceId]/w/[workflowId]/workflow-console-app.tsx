'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Console } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/console'
import { WorkflowRouteProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import { SocketProvider } from '@/contexts/socket-context'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  WorkflowStoreProvider,
} from '@/stores/workflows/workflow/store-client'

interface WorkflowConsoleAppProps {
  workspaceId: string
  workflowId: string
  panelWidth: number
  channelId?: string
}

const WorkflowConsoleApp = ({
  workspaceId,
  workflowId,
  panelWidth,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
}: WorkflowConsoleAppProps) => {
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
            <div className='flex h-full w-full flex-col overflow-y-auto bg-[hsl(var(--workflow-background))]'>
              <Console panelWidth={panelWidth} hideScrollbar={false} />
            </div>
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </SocketProvider>
    </Providers>
  )
}

export default WorkflowConsoleApp
export { WorkflowConsoleApp }
