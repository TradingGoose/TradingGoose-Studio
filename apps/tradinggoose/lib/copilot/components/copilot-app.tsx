'use client'

import { LoadingAgent } from '@/components/ui/loading-agent'
import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import type { ChatContext } from '@/stores/copilot/types'
import { Copilot } from './copilot/copilot'

interface CopilotAppProps {
  workspaceId: string
  panelWidth: number
  currentContext?: ChatContext | null
}

export function CopilotApp({ workspaceId, panelWidth, currentContext }: CopilotAppProps) {
  const session = useSession()

  const userId = session.data?.user?.id

  if (!userId) {
    return (
      <div
        className='flex h-full w-full items-center justify-center'
        role='status'
        aria-label='Loading Copilot'
        aria-busy='true'
      >
        <LoadingAgent size='md' />
      </div>
    )
  }
  return (
    <Providers workspaceId={workspaceId} userId={userId}>
      <div className='flex h-full w-full flex-col overflow-hidden'>
        <Copilot
          workspaceId={workspaceId}
          panelWidth={panelWidth}
          currentContext={currentContext}
        />
      </div>
    </Providers>
  )
}
