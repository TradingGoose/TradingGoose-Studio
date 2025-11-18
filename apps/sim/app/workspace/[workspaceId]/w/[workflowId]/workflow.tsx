'use client'

import React, { useMemo } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'
import WorkflowCanvas, {
  type WorkflowCanvasUIConfig,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-editor/workflow-canvas'
import { useWorkflowUIConfig } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-ui-context'

export type WorkflowUIConfig = WorkflowCanvasUIConfig

interface WorkflowProps {
  ui?: WorkflowCanvasUIConfig
  disableNavigation?: boolean
  channelId?: string
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

export const WorkflowEditorProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ReactFlowProvider>
      <ErrorBoundary>{children}</ErrorBoundary>
    </ReactFlowProvider>
  )
}

const Workflow = React.memo(({ ui, disableNavigation, channelId, viewportBounds }: WorkflowProps) => {
  const layoutUI = useWorkflowUIConfig()
  const mergedUI = useMemo<WorkflowCanvasUIConfig | undefined>(() => {
    if (!ui && !layoutUI) return ui
    return { ...layoutUI, ...ui }
  }, [layoutUI, ui])

  return (
    <WorkflowEditorProvider>
      <WorkflowCanvas
        channelId={channelId}
        ui={mergedUI}
        disableNavigation={disableNavigation}
        viewportBounds={viewportBounds}
      />
    </WorkflowEditorProvider>
  )
})

Workflow.displayName = 'Workflow'

export default Workflow
