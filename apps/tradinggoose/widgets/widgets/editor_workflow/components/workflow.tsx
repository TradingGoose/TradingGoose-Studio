'use client'

import React, { useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { ErrorBoundary } from '@/widgets/widgets/editor_workflow/components/error'
import WorkflowCanvas, {
  type WorkflowCanvasUIConfig,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import { useWorkflowUIConfig } from '@/widgets/widgets/editor_workflow/context/workflow-ui-context'

export type WorkflowUIConfig = WorkflowCanvasUIConfig

interface WorkflowProps {
  ui?: WorkflowCanvasUIConfig
  disableNavigation?: boolean
  channelId?: string
  toolbarScopeId?: string
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

export const WorkflowEditorProvider = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>
    <ErrorBoundary>{children}</ErrorBoundary>
  </ReactFlowProvider>
)

const Workflow = React.memo(
  ({ ui, disableNavigation, channelId, toolbarScopeId, viewportBounds }: WorkflowProps) => {
    const layoutUI = useWorkflowUIConfig()
    const mergedUI = useMemo<WorkflowCanvasUIConfig | undefined>(() => {
      if (!ui && !layoutUI) return ui
      return { ...layoutUI, ...ui }
    }, [layoutUI, ui])

    return (
      <WorkflowEditorProvider>
        <WorkflowCanvas
          channelId={channelId}
          toolbarScopeId={toolbarScopeId}
          ui={mergedUI}
          disableNavigation={disableNavigation}
          viewportBounds={viewportBounds}
        />
      </WorkflowEditorProvider>
    )
  }
)

Workflow.displayName = 'Workflow'

export default Workflow
