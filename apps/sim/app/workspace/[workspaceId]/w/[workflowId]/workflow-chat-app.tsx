'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { SocketProvider } from '@/contexts/socket-context'
import { WorkflowRouteProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import { Chat } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/chat'
import {
  WorkflowStoreProvider,
  DEFAULT_WORKFLOW_CHANNEL_ID,
} from '@/stores/workflows/workflow/store-client'
import { useState } from 'react'

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
        <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId} channelId={channelId}>
          <WorkflowStoreProvider channelId={channelId}>
            <div className='flex h-full w-full flex-col overflow-y-auto bg-[hsl(var(--workflow-background))]'>
              <Chat chatMessage={chatMessage} setChatMessage={setChatMessage} hideScrollbar={false} />
            </div>
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </SocketProvider>
    </Providers>
  )
}

export default WorkflowChatApp
export { WorkflowChatApp }
