'use client'

import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Copilot } from './copilot/copilot'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { SocketProvider } from '@/contexts/socket-context'
import { CopilotStoreProvider } from '@/stores/copilot/store'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  WorkflowStoreProvider,
} from '@/stores/workflows/workflow/store-client'
import type { PairColor } from '@/widgets/pair-colors'

interface copilotAppProps {
  workspaceId: string
  workflowId: string
  panelWidth: number
  channelId?: string
  copilotChannelId?: string
  pairColor: PairColor
  chatId?: string | null
  onChatChange?: (chatId: string | null) => void
}

const copilotApp = ({
  workspaceId,
  workflowId,
  panelWidth,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  copilotChannelId,
  pairColor,
  chatId,
  onChatChange,
}: copilotAppProps) => {
  const session = useSession()
  const copilotStoreChannel = copilotChannelId ?? channelId

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
            <CopilotStoreProvider channelId={copilotStoreChannel}>
              <div className='flex h-full w-full flex-col overflow-hidden '>
                <Copilot
                  key={copilotStoreChannel}
                  panelWidth={panelWidth}
                  pairColor={pairColor}
                  initialChatId={chatId ?? null}
                  onChatIdChange={onChatChange}
                />
              </div>
            </CopilotStoreProvider>
          </WorkflowStoreProvider>
        </WorkflowRouteProvider>
      </SocketProvider>
    </Providers>
  )
}

export default copilotApp
export { copilotApp }
