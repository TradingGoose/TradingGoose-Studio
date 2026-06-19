'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Terminal } from './terminal/terminal'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'

interface WorkflowConsoleAppProps {
  workspaceId: string
  workflowId: string
  panelWidth: number
  panelId?: string
  channelId?: string
}

const WorkflowConsoleApp = ({
  workspaceId,
  workflowId,
  panelWidth,
  panelId,
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
      <WorkflowSessionProvider
        workspaceId={workspaceId}
        workflowId={workflowId}
        user={user}
      >
        <WorkflowRouteProvider
          workspaceId={workspaceId}
          workflowId={workflowId}
          channelId={channelId}
        >
          <div className='flex h-full w-full flex-col overflow-hidden'>
            <Terminal
              panelWidth={panelWidth}
              hideScrollbar={false}
              uiKey={panelId ?? `${workspaceId}-${workflowId}`}
            />
          </div>
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

export default WorkflowConsoleApp
export { WorkflowConsoleApp }
