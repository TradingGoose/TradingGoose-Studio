'use client'

import React, { useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useWorkflowSession } from '@/lib/yjs/workflow-session-host'
import { ErrorBoundary } from '@/widgets/widgets/editor_workflow/components/error'
import WorkflowCanvas, {
  type WorkflowCanvasUIConfig,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import { useWorkflowUIConfig } from '@/widgets/widgets/editor_workflow/context/workflow-ui-context'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { useWorkflowEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

export type WorkflowUIConfig = WorkflowCanvasUIConfig

interface WorkflowProps {
  ui?: WorkflowCanvasUIConfig
  disableNavigation?: boolean
  channelId?: string
  toolbarScopeId?: string
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

const Workflow = React.memo(
  ({ ui, disableNavigation, channelId, toolbarScopeId, viewportBounds }: WorkflowProps) => {
    const layoutUI = useWorkflowUIConfig()
    const copy = useWorkflowEditorCopy()
    const workflowSession = useWorkflowSession()
    const mergedUI = useMemo<WorkflowCanvasUIConfig | undefined>(() => {
      if (!ui && !layoutUI) return ui
      return { ...layoutUI, ...ui }
    }, [layoutUI, ui])

    if (workflowSession.error) {
      return <WidgetStateMessage message={workflowSession.error} />
    }

    if (workflowSession.isLoading || !workflowSession.doc) {
      return (
        <div className='flex h-full w-full items-center justify-center'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    return (
      <ReactFlowProvider>
        <ErrorBoundary fallback={<WidgetStateMessage message={copy.unableToLoadWorkflows} />}>
          <WorkflowCanvas
            channelId={channelId}
            toolbarScopeId={toolbarScopeId}
            ui={mergedUI}
            disableNavigation={disableNavigation}
            viewportBounds={viewportBounds}
          />
        </ErrorBoundary>
      </ReactFlowProvider>
    )
  }
)

Workflow.displayName = 'Workflow'

export default Workflow
