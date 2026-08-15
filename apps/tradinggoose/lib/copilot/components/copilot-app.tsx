'use client'

import { useSession } from '@/lib/auth-client'
import { resolveCopilotWorkflowId } from '@/lib/copilot/live-contexts'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import type { ChatContext } from '@/stores/copilot/types'
import { Copilot } from './copilot/copilot'

interface CopilotAppProps {
  workspaceId: string
  panelWidth: number
  effectiveParams?: Record<string, unknown> | null
  layoutId?: string | null
  ownerUserId?: string | null
  layoutName?: string | null
  currentContext?: ChatContext | null
  inputDisabled?: boolean
}

export function CopilotApp({
  workspaceId,
  panelWidth,
  effectiveParams,
  layoutId,
  ownerUserId,
  layoutName,
  currentContext,
  inputDisabled,
}: CopilotAppProps) {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  if (!user) return null
  const workflowId = resolveCopilotWorkflowId(effectiveParams) ?? null

  return (
    <Providers workspaceId={workspaceId} userId={user.id}>
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
            inputDisabled={inputDisabled}
          />
        </div>
      </WorkflowSessionProvider>
    </Providers>
  )
}
