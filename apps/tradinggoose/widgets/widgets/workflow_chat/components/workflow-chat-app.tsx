'use client'

import { useState, type ReactNode } from 'react'
import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Chat } from './chat/chat'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'

interface WorkflowChatAppProps {
  workspaceId: string
  workflowId: string
  channelId?: string
}

interface WorkflowChatSessionProvidersProps {
  workspaceId: string
  workflowId: string
  channelId?: string
  children: ReactNode
}

const WorkflowChatSessionProviders = ({
  workspaceId,
  workflowId,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
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
    <Providers workspaceId={workspaceId}>
      <WorkflowSessionProvider
        workspaceId={workspaceId}
        workflowId={workflowId}
        user={user}
      >
        <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId} channelId={channelId}>
          {children}
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

const WorkflowChatApp = ({
  workspaceId,
  workflowId,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
}: WorkflowChatAppProps) => {
  const [chatMessage, setChatMessage] = useState('')

  return (
    <WorkflowChatSessionProviders
      workspaceId={workspaceId}
      workflowId={workflowId}
      channelId={channelId}
    >
      <div className='flex h-full w-full flex-col overflow-y-auto'>
        <Chat
          chatMessage={chatMessage}
          setChatMessage={setChatMessage}
          hideScrollbar={false}
        />
      </div>
    </WorkflowChatSessionProviders>
  )
}

export default WorkflowChatApp
export { WorkflowChatApp }
export { WorkflowChatSessionProviders }
