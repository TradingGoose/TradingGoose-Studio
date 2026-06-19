'use client'

import { useSession } from '@/lib/auth-client'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { CopilotStoreProvider, DEFAULT_COPILOT_CHANNEL_ID } from '@/stores/copilot/store'
import { normalizePairColorContext, usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
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
}

const CopilotAppContent = ({
  workspaceId,
  panelWidth,
  channelId,
  pairColor,
  user,
}: {
  workspaceId: string
  panelWidth: number
  channelId: string
  pairColor: PairColor
  user: CopilotAppUser
}) => {
  const pairContext = normalizePairColorContext(usePairColorContext(pairColor))
  const workflowId = resolveCopilotWorkflowId(pairContext) ?? null

  const renderCopilotBody = () => (
    <div className='flex h-full w-full flex-col overflow-hidden '>
      <Copilot
        key={channelId}
        workspaceId={workspaceId}
        panelWidth={panelWidth}
        pairColor={pairColor}
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
    <Providers workspaceId={workspaceId}>
      <CopilotStoreProvider channelId={channelId}>
        <CopilotAppContent
          workspaceId={workspaceId}
          panelWidth={panelWidth}
          channelId={channelId}
          pairColor={pairColor}
          user={user}
        />
      </CopilotStoreProvider>
    </Providers>
  )
}

export default CopilotApp
export { CopilotApp }
