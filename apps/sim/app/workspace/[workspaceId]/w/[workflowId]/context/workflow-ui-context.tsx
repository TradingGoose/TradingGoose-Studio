'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { WorkflowCanvasUIConfig } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-editor/workflow-canvas'

const DEFAULT_UI_CONFIG: WorkflowCanvasUIConfig = {
  panel: false,
  controlBar: false,
  floatingControls: false,
  trainingControls: false,
  diffControls: true,
  triggerList: true,
}

const WorkflowUIConfigContext = createContext<WorkflowCanvasUIConfig>(DEFAULT_UI_CONFIG)

interface WorkflowUIConfigProviderProps {
  value?: WorkflowCanvasUIConfig
  children: ReactNode
}

export function WorkflowUIConfigProvider({ value, children }: WorkflowUIConfigProviderProps) {
  const mergedValue = useMemo(() => ({ ...DEFAULT_UI_CONFIG, ...value }), [value])
  return (
    <WorkflowUIConfigContext.Provider value={mergedValue}>
      {children}
    </WorkflowUIConfigContext.Provider>
  )
}

export function useWorkflowUIConfig(): WorkflowCanvasUIConfig {
  return useContext(WorkflowUIConfigContext)
}
