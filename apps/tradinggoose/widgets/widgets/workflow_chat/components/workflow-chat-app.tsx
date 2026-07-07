'use client'

import { type ReactNode, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { Chat } from './chat/chat'

interface WorkflowChatAppProps {
  workspaceId: string
  workflowId: string
}

interface WorkflowChatSessionProvidersProps {
  workspaceId: string
  workflowId: string
  children: ReactNode
}

const WorkflowChatSessionProviders = ({
  workspaceId,
  workflowId,
  children,
}: WorkflowChatSessionProvidersProps) => {
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
          {children}
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

const WorkflowChatApp = ({ workspaceId, workflowId }: WorkflowChatAppProps) => {
  const [chatMessage, setChatMessage] = useState('')

  return (
    <WorkflowChatSessionProviders workspaceId={workspaceId} workflowId={workflowId}>
      <div className='flex h-full w-full flex-col overflow-y-auto'>
        <Chat chatMessage={chatMessage} setChatMessage={setChatMessage} hideScrollbar={false} />
      </div>
    </WorkflowChatSessionProviders>
  )
}

export default WorkflowChatApp
export { WorkflowChatApp }
export { WorkflowChatSessionProviders }
