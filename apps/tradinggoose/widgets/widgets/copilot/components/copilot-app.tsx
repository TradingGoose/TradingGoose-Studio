'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { CopilotStoreProvider, DEFAULT_COPILOT_CHANNEL_ID } from '@/stores/copilot/store'
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
  channelId?: string
  effectiveParams?: Record<string, unknown> | null
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
}

const CopilotAppContent = ({
  workspaceId,
  panelWidth,
  effectiveParams,
  layoutId,
  ownerUserId,
  layoutName,
  user,
}: {
  workspaceId: string
  panelWidth: number
  effectiveParams?: Record<string, unknown> | null
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
  user: CopilotAppUser
}) => {
  const workflowId = resolveCopilotWorkflowId(effectiveParams) ?? null

  const body = (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        workspaceId={workspaceId}
        panelWidth={panelWidth}
        effectiveParams={effectiveParams}
        layoutId={layoutId}
        ownerUserId={ownerUserId}
        layoutName={layoutName}
        authenticatedUserId={user?.id ?? null}
        reviewTarget={null}
      />
    </div>
  )

  return workflowId ? (
    <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
      {body}
    </WorkflowSessionProvider>
  ) : (
    body
  )
}

const CopilotApp = ({
  workspaceId,
  panelWidth,
  channelId = DEFAULT_COPILOT_CHANNEL_ID,
  effectiveParams,
  layoutId,
  ownerUserId,
  layoutName,
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
          user={user}
        />
      </CopilotStoreProvider>
    </Providers>
  )
}

export default CopilotApp
export { CopilotApp }
