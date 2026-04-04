'use client'

import { useState } from 'react'
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
          <div className='flex h-full w-full flex-col overflow-y-auto'>
            <Chat
              chatMessage={chatMessage}
              setChatMessage={setChatMessage}
              hideScrollbar={false}
            />
          </div>
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

export default WorkflowChatApp
export { WorkflowChatApp }
