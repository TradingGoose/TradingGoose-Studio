'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { CopilotStoreProvider, DEFAULT_COPILOT_CHANNEL_ID } from '@/stores/copilot/store'
import { normalizePairColorContext } from '@/widgets/color-pairs'
import type { PairColor } from '@/widgets/pair-colors'
import { useWidgetPairContext } from '@/widgets/widget-config-runtime'
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
  pairColor: PairColor
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
}

const CopilotAppContent = ({
  workspaceId,
  panelWidth,
  channelId,
  pairColor,
  layoutId,
  ownerUserId,
  layoutName,
  user,
}: {
  workspaceId: string
  panelWidth: number
  channelId: string
  pairColor: PairColor
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
  user: CopilotAppUser
}) => {
  const pairContext = normalizePairColorContext(useWidgetPairContext(pairColor))
  const workflowId = resolveCopilotWorkflowId(pairContext) ?? null

  const renderCopilotBody = () => (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={channelId}
        workspaceId={workspaceId}
        panelWidth={panelWidth}
        pairColor={pairColor}
        layoutId={layoutId}
        ownerUserId={ownerUserId}
        layoutName={layoutName}
        authenticatedUserId={user?.id ?? null}
        reviewTarget={null}
      />
    </div>
  )

  const renderWorkflowContent = () =>
    workflowId ? (
      <WorkflowSessionProvider workspaceId={workspaceId} workflowId={workflowId} user={user}>
        {renderCopilotBody()}
      </WorkflowSessionProvider>
    ) : (
      renderCopilotBody()
    )

  return renderWorkflowContent()
}

const CopilotApp = ({
  workspaceId,
  panelWidth,
  channelId = DEFAULT_COPILOT_CHANNEL_ID,
  pairColor,
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

  return (
    <Providers workspaceId={workspaceId} inheritUser>
      <CopilotStoreProvider channelId={channelId}>
        <CopilotAppContent
          workspaceId={workspaceId}
          panelWidth={panelWidth}
          channelId={channelId}
          pairColor={pairColor}
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
