'use client'

import { useCallback, useEffect } from 'react'
import { useSession } from '@/lib/auth-client'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { WorkflowSessionProvider } from '@/lib/yjs/workflow-session-host'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { WORKFLOW_VARIABLES_ADD_EVENT } from '@/widgets/events'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { Variables } from '@/widgets/widgets/workflow_variables/components/variables/variables'

interface WorkflowVariablesAppProps {
  workspaceId: string
  workflowId: string
  accessMode: ReviewAccessMode
  panelId?: string
}

const WorkflowVariablesApp = ({
  workspaceId,
  workflowId,
  accessMode,
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
    <Providers workspaceId={workspaceId} inheritUser>
      <WorkflowSessionProvider
        workspaceId={workspaceId}
        workflowId={workflowId}
        accessMode={accessMode}
        user={user}
      >
        <WorkflowRouteProvider workspaceId={workspaceId} workflowId={workflowId}>
          <WorkflowVariablesAppContent
            workflowId={workflowId}
            panelId={panelId}
            accessMode={accessMode}
          />
        </WorkflowRouteProvider>
      </WorkflowSessionProvider>
    </Providers>
  )
}

const WorkflowVariablesAppContent = ({
  workflowId,
  panelId,
  accessMode,
}: {
  workflowId: string
  panelId?: string
  accessMode: ReviewAccessMode
}) => {
  const { collaborativeAddVariable } = useWorkflowEditorActions()

  const handleAddVariable = useCallback(() => {
    if (!workflowId || accessMode !== 'write') return

    collaborativeAddVariable({
      name: '',
      type: 'plain',
      value: '',
      workflowId,
    })
  }, [accessMode, collaborativeAddVariable, workflowId])

  useEffect(() => {
    if (accessMode !== 'write') return
    const handleEvent = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail
      if (!detail) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (detail.workflowId && detail.workflowId !== workflowId) return
      handleAddVariable()
    }

    window.addEventListener(WORKFLOW_VARIABLES_ADD_EVENT, handleEvent as EventListener)
    return () => {
      window.removeEventListener(WORKFLOW_VARIABLES_ADD_EVENT, handleEvent as EventListener)
    }
  }, [accessMode, workflowId, panelId, handleAddVariable])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden px-3 py-2'>
      <Variables workflowId={workflowId} hideAddButtons />
    </div>
  )
}

export default WorkflowVariablesApp
export { WorkflowVariablesApp }
