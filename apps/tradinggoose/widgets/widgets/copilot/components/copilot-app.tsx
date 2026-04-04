'use client'

import { useMemo } from 'react'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { useSession } from '@/lib/auth-client'
import type { CopilotChat } from '@/lib/copilot/api'
import { EntitySessionHost } from '@/lib/copilot/review-sessions/entity-session-host'
import { deriveYjsSessionId } from '@/lib/copilot/review-sessions/identity'
import {
  REVIEW_ENTITY_KINDS,
  type ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import { CopilotStoreProvider, useCopilotStore } from '@/stores/copilot/store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import type { PairColor } from '@/widgets/pair-colors'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { Copilot } from './copilot/copilot'

interface CopilotAppProps {
  workspaceId: string
  workflowId: string
  panelWidth: number
  channelId?: string
  copilotChannelId?: string
  pairColor: PairColor
}

const buildReviewTargetDescriptorFromChat = (
  workspaceId: string,
  currentChat: CopilotChat | null
): ReviewTargetDescriptor | null => {
  if (
    !currentChat?.reviewSessionId ||
    !currentChat.entityKind ||
    currentChat.entityKind === 'workflow' ||
    !REVIEW_ENTITY_KINDS.includes(currentChat.entityKind as any)
  ) {
    return null
  }

  return {
    workspaceId: currentChat.workspaceId ?? workspaceId,
    entityKind: currentChat.entityKind as any,
    entityId: currentChat.entityId ?? null,
    draftSessionId: currentChat.draftSessionId ?? null,
    reviewSessionId: currentChat.reviewSessionId,
    yjsSessionId: deriveYjsSessionId({
      entityKind: currentChat.entityKind as any,
      entityId: currentChat.entityId ?? null,
      reviewSessionId: currentChat.reviewSessionId,
    }),
  }
}

const CopilotAppContent = ({
  workspaceId,
  workflowId,
  panelWidth,
  copilotStoreChannel,
  pairColor,
  user,
}: {
  workspaceId: string
  workflowId: string
  panelWidth: number
  copilotStoreChannel: string
  pairColor: PairColor
  user:
    | {
        id: string
        name?: string
        email: string
      }
    | undefined
}) => {
  const currentChat = useCopilotStore((state) => state.currentChat)
  // Only dedicated entity review chats bind the copilot UI to an entity review
  // session. Generic panel-scoped copilot chats continue to use the current view
  // as live context and do not switch chat threads when the viewed entity changes.
  const entityDescriptor = useMemo(
    () => buildReviewTargetDescriptorFromChat(workspaceId, currentChat),
    [currentChat, workspaceId]
  )

  const copilotContent = (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={copilotStoreChannel}
        channelId={copilotStoreChannel}
        panelWidth={panelWidth}
        pairColor={pairColor}
      />
    </div>
  )

  if (entityDescriptor) {
    return (
      <EntitySessionHost descriptor={entityDescriptor} user={user}>
        {copilotContent}
      </EntitySessionHost>
    )
  }

  return (
    <WorkflowSessionProvider
      workspaceId={workspaceId}
      workflowId={workflowId}
      user={user}
    >
      {copilotContent}
    </WorkflowSessionProvider>
  )
}

const CopilotApp = ({
  workspaceId,
  workflowId,
  panelWidth,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  copilotChannelId,
  pairColor,
}: CopilotAppProps) => {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  const copilotStoreChannel = copilotChannelId ?? channelId

  return (
    <Providers workspaceId={workspaceId}>
      <WorkflowRouteProvider
        workspaceId={workspaceId}
        workflowId={workflowId}
        channelId={channelId}
      >
        <CopilotStoreProvider channelId={copilotStoreChannel}>
          <CopilotAppContent
            workspaceId={workspaceId}
            workflowId={workflowId}
            panelWidth={panelWidth}
            copilotStoreChannel={copilotStoreChannel}
            pairColor={pairColor}
            user={user}
          />
        </CopilotStoreProvider>
      </WorkflowRouteProvider>
    </Providers>
  )
}

export default CopilotApp
export { CopilotApp }
