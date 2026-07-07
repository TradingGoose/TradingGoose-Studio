'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

interface WorkflowRouteContextValue {
  workspaceId: string
  workflowId: string
}

const WorkflowRouteContext = createContext<WorkflowRouteContextValue | null>(null)

interface WorkflowRouteProviderProps {
  workspaceId: string
  workflowId: string
  children: ReactNode
}

export function WorkflowRouteProvider({
  workspaceId,
  workflowId,
  children,
}: WorkflowRouteProviderProps) {
  const value = useMemo(
    () => ({
      workspaceId,
      workflowId,
    }),
    [workspaceId, workflowId]
  )

  return <WorkflowRouteContext.Provider value={value}>{children}</WorkflowRouteContext.Provider>
}

export function useWorkflowRoute() {
  const context = useContext(WorkflowRouteContext)
  if (!context) {
    throw new Error('useWorkflowRoute must be used within a WorkflowRouteProvider')
  }

  return context
}

export function useOptionalWorkflowRoute() {
  return useContext(WorkflowRouteContext)
}

export function useWorkspaceId() {
  return useWorkflowRoute().workspaceId
}

export function useWorkflowId() {
  return useWorkflowRoute().workflowId
}
