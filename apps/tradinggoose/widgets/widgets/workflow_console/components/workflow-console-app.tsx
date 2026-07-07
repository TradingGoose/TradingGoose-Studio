'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { Terminal } from './terminal/terminal'

interface WorkflowConsoleAppProps {
  workspaceId: string
  workflowId: string
  panelWidth: number
  panelId?: string
}

const WorkflowConsoleApp = ({
  workspaceId,
  workflowId,
  panelWidth,
  panelId,
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
    <Providers workspaceId={workspaceId} inheritUser>
      <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
        <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId}>
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
