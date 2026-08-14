'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { CopilotStoreProvider } from '@/stores/copilot/store'
import type { ChatContext } from '@/stores/copilot/types'
import { resolveCopilotWorkflowId } from '@/widgets/widgets/copilot/live-contexts'
import { Copilot } from './copilot/copilot'

type CopilotAppUser =
  | {
      id: string
      name?: string
      email: string
    }
  | undefined

interface CopilotAppProps {
  workspaceId: string
  panelWidth: number
  channelId: string
  effectiveParams?: Record<string, unknown> | null
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
  currentContext?: ChatContext | null
  inputDisabled?: boolean
}

const CopilotAppContent = ({
  workspaceId,
  panelWidth,
  effectiveParams,
  layoutId,
  ownerUserId,
  layoutName,
  currentContext,
  inputDisabled,
  user,
}: {
  workspaceId: string
  panelWidth: number
  effectiveParams?: Record<string, unknown> | null
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
  currentContext?: ChatContext | null
  inputDisabled?: boolean
  user: CopilotAppUser
}) => {
  const workflowId = resolveCopilotWorkflowId(effectiveParams) ?? null

  return (
    <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
      <div className='flex h-full w-full flex-col overflow-hidden'>
        <Copilot
          workspaceId={workspaceId}
          panelWidth={panelWidth}
          effectiveParams={effectiveParams}
          layoutId={layoutId}
          ownerUserId={ownerUserId}
          layoutName={layoutName}
          currentContext={currentContext}
          authenticatedUserId={user?.id ?? null}
          inputDisabled={inputDisabled}
          reviewTarget={null}
        />
      </div>
    </WorkflowSessionProvider>
  )
}

const CopilotApp = ({
  workspaceId,
  panelWidth,
  channelId,
  effectiveParams,
  layoutId,
  ownerUserId,
  layoutName,
  currentContext,
  inputDisabled,
}: CopilotAppProps) => {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  if (!user) return null

  return (
    <Providers workspaceId={workspaceId} userId={user.id}>
      <CopilotStoreProvider channelId={channelId}>
        <CopilotAppContent
          workspaceId={workspaceId}
          panelWidth={panelWidth}
          effectiveParams={effectiveParams}
          layoutId={layoutId}
          ownerUserId={ownerUserId}
          layoutName={layoutName}
          currentContext={currentContext}
          inputDisabled={inputDisabled}
          user={user}
        />
      </CopilotStoreProvider>
    </Providers>
  )
}

export default CopilotApp
export { CopilotApp }
