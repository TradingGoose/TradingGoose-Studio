'use client'

import { useState } from 'react'
import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Chat } from './chat/chat'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { SocketProvider } from '@/contexts/socket-context'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  WorkflowStoreProvider,
} from '@/stores/workflows/workflow/store-client'

interface WorkflowChatAppProps {
  workspaceId: string
  workflowId: string
  channelId?: string
}

const WorkflowChatApp = ({
  workspaceId,
  workflowId,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
}: WorkflowChatAppProps) => {
  const session = useSession()
  const [chatMessage, setChatMessage] = useState('')

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
          <WorkflowStoreProvider channelId={channelId} workflowId={workflowId}>
            <div className='flex h-full w-full flex-col overflow-y-auto bg-[hsl(var(--workflow-background))]'>
              <Chat
                chatMessage={chatMessage}
                setChatMessage={setChatMessage}
                hideScrollbar={false}
              />
            </div>
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </SocketProvider>
    </Providers>
  )
}

export default WorkflowChatApp
export { WorkflowChatApp }
