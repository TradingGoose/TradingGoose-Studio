'use client'

import { useCallback, useEffect } from 'react'
import { useSession } from '@/lib/auth-client'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Variables } from '@/widgets/widgets/workflow_variables/components/variables/variables'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { WORKFLOW_VARIABLES_ADD_EVENT } from '@/widgets/events'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'

interface WorkflowVariablesAppProps {
  workspaceId: string
  workflowId: string
  channelId?: string
  panelId?: string
}

const WorkflowVariablesApp = ({
  workspaceId,
  workflowId,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  panelId,
}: WorkflowVariablesAppProps) => {
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
          <WorkflowVariablesAppContent
            workflowId={workflowId}
            channelId={channelId}
            panelId={panelId}
          />
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

const WorkflowVariablesAppContent = ({
  workflowId,
  channelId,
  panelId,
}: {
  workflowId: string
  channelId: string
  panelId?: string
}) => {
  const { collaborativeAddVariable } = useWorkflowEditorActions()

  const handleAddVariable = useCallback(() => {
    if (!workflowId) return

    collaborativeAddVariable({
      name: '',
      type: 'string',
      value: '',
      workflowId,
    })
  }, [collaborativeAddVariable, workflowId])

  useEffect(() => {
    const handleEvent = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail
      if (!detail) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (detail.channelId && detail.channelId !== channelId) return
      handleAddVariable()
    }

    window.addEventListener(WORKFLOW_VARIABLES_ADD_EVENT, handleEvent as EventListener)
    return () => {
      window.removeEventListener(WORKFLOW_VARIABLES_ADD_EVENT, handleEvent as EventListener)
    }
  }, [channelId, panelId, handleAddVariable])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden  px-3 py-2'>
      <Variables workflowId={workflowId} hideAddButtons />
    </div>
  )
}

export default WorkflowVariablesApp
export { WorkflowVariablesApp }
